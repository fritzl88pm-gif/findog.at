from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.request import urlopen

import cv2
import numpy as np
import onnxruntime as ort


U2NETP_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
U2NETP_SHA256 = "309C8469258DDA742793DCE0EBEA8E6DD393174F89934733ECC8B14C76F4DDD8"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract Cyberfred's jump from a provided MP4 into a transparent sprite atlas.",
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--metadata", type=Path)
    parser.add_argument("--start-frame", type=int, default=32)
    parser.add_argument("--end-frame", type=int, default=82)
    parser.add_argument("--frame-count", type=int, default=32)
    parser.add_argument("--columns", type=int, default=8)
    parser.add_argument(
        "--model",
        type=Path,
        default=Path.home() / ".rembg" / "models" / "u2netp" / "u2netp.onnx",
    )
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def selected_indices(start_frame: int, end_frame: int, frame_count: int) -> list[int]:
    if start_frame < 0 or end_frame < start_frame:
        raise ValueError("Invalid Cyberfred frame range.")
    if frame_count < 2:
        raise ValueError("Cyberfred output needs at least two frames.")
    indices = np.rint(np.linspace(start_frame, end_frame, frame_count)).astype(int).tolist()
    if len(set(indices)) != len(indices):
        raise ValueError("Requested Cyberfred frame count creates duplicate source frames.")
    return indices


def read_video_frames(source: Path) -> tuple[list[np.ndarray], float]:
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open Cyberfred video: {source}")
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    frames: list[np.ndarray] = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frames.append(frame)
    capture.release()
    if not frames:
        raise RuntimeError("Cyberfred video contains no readable frames.")
    return frames, fps


def ensure_u2netp_model(model_path: Path) -> Path:
    if model_path.is_file() and sha256(model_path) == U2NETP_SHA256:
        return model_path
    if model_path.exists():
        raise RuntimeError(f"Cyberfred segmentation model has an invalid checksum: {model_path}")

    model_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = model_path.with_suffix(".download")
    with urlopen(U2NETP_URL, timeout=60) as response, temporary_path.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    if sha256(temporary_path) != U2NETP_SHA256:
        temporary_path.unlink(missing_ok=True)
        raise RuntimeError("Downloaded Cyberfred segmentation model failed checksum validation.")
    os.replace(temporary_path, model_path)
    return model_path


class SubjectSegmenter:
    def __init__(self, model_path: Path) -> None:
        self.model_path = ensure_u2netp_model(model_path)
        self.session = ort.InferenceSession(
            str(self.model_path),
            providers=["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name

    def predict_alpha(self, frame: np.ndarray) -> np.ndarray:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(rgb, (320, 320), interpolation=cv2.INTER_LANCZOS4)
        image = resized.astype(np.float32) / max(float(resized.max()), 1e-6)
        mean = np.array((0.485, 0.456, 0.406), dtype=np.float32)
        std = np.array((0.229, 0.224, 0.225), dtype=np.float32)
        normalized = ((image - mean) / std).transpose(2, 0, 1)[None, ...]
        prediction = self.session.run(None, {self.input_name: normalized})[0][:, 0, :, :]
        prediction = np.squeeze(prediction)
        minimum = float(prediction.min())
        maximum = float(prediction.max())
        prediction = (prediction - minimum) / max(maximum - minimum, 1e-6)
        alpha = cv2.resize(prediction, (frame.shape[1], frame.shape[0]), interpolation=cv2.INTER_LANCZOS4)
        return np.clip(alpha * 255, 0, 255).astype(np.uint8)


def fill_enclosed_holes(binary_mask: np.ndarray) -> np.ndarray:
    padded = cv2.copyMakeBorder(binary_mask, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    flooded = padded.copy()
    cv2.floodFill(flooded, None, (0, 0), 255)
    holes = cv2.bitwise_not(flooded)[1:-1, 1:-1]
    return cv2.bitwise_or(binary_mask, holes)


def estimate_background(frames: list[np.ndarray]) -> np.ndarray:
    """Rebuild the video's empty studio background from its untouched side margins."""
    stack = np.stack(frames, axis=0)
    side_samples = np.concatenate((stack[:, :, :72], stack[:, :, -72:]), axis=2)
    row_colors = np.median(side_samples, axis=(0, 2)).astype(np.uint8)
    row_colors = cv2.GaussianBlur(row_colors[:, None, :], (1, 0), 5.0)[:, 0, :]
    return np.repeat(row_colors[:, None, :], frames[0].shape[1], axis=1)


def keep_largest_component(binary_mask: np.ndarray) -> np.ndarray:
    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(binary_mask, 8)
    if component_count <= 1:
        raise RuntimeError("Cyberfred subject segmentation produced an empty frame.")
    largest_label = int(np.argmax(stats[1:, cv2.CC_STAT_AREA])) + 1
    return np.where(labels == largest_label, 255, 0).astype(np.uint8)


def keep_effects_touching_character(
    effect_mask: np.ndarray,
    character_mask: np.ndarray,
) -> np.ndarray:
    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(effect_mask, 8)
    nearby_character = cv2.dilate(character_mask, np.ones((19, 19), np.uint8), iterations=1)
    kept = np.zeros_like(effect_mask)
    for label in range(1, component_count):
        if stats[label, cv2.CC_STAT_AREA] < 6:
            continue
        component = labels == label
        if np.any(nearby_character[component] > 0):
            kept[component] = 255
    return kept


def remove_background(
    frame: np.ndarray,
    background: np.ndarray,
    segmenter: SubjectSegmenter,
    booster_active: bool,
) -> tuple[np.ndarray, dict[str, int]]:
    height, width = frame.shape[:2]
    if height != 640 or width != 640:
        raise RuntimeError(f"Unexpected Cyberfred video frame size: {width}x{height}.")

    frame_lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB).astype(np.float32)
    background_lab = cv2.cvtColor(background, cv2.COLOR_BGR2LAB).astype(np.float32)
    difference = np.sqrt(np.sum((frame_lab - background_lab) ** 2, axis=2))

    subject_alpha = segmenter.predict_alpha(frame)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    studio_like = (difference < 12.0) & (hsv[:, :, 1] < 12)
    reliable_foreground = ((difference >= 12.0) | (hsv[:, :, 1] >= 12)).astype(np.uint8) * 255
    reliable_neighborhood = cv2.dilate(
        reliable_foreground,
        np.ones((9, 9), np.uint8),
        iterations=1,
    )
    subject_alpha[studio_like & (reliable_neighborhood == 0)] = 0
    subject_alpha[studio_like & (np.indices((height, width))[0] > 520)] = 0
    character_mask = keep_largest_component(
        np.where(subject_alpha > 128, 255, 0).astype(np.uint8),
    )
    character_mask = cv2.morphologyEx(
        character_mask,
        cv2.MORPH_CLOSE,
        np.ones((11, 11), np.uint8),
    )
    character_mask = fill_enclosed_holes(character_mask)
    character_support = cv2.dilate(character_mask, np.ones((5, 5), np.uint8), iterations=1)
    subject_alpha[character_support == 0] = 0
    subject_alpha[(character_mask > 0) & (subject_alpha < 128)] = 128

    y_coordinates = np.indices((height, width))[0]
    blue_bias = frame[:, :, 0].astype(np.int16) - frame[:, :, 2].astype(np.int16)
    background_hsv = cv2.cvtColor(background, cv2.COLOR_BGR2HSV)
    brightness_lift = (
        hsv[:, :, 2].astype(np.int16) - background_hsv[:, :, 2].astype(np.int16)
    )
    flame_candidate = (
        (y_coordinates > 390)
        & (y_coordinates < 560)
        & (hsv[:, :, 2] > 145)
        & (blue_bias > 7)
        & (difference > 4.5)
    ).astype(np.uint8) * 255
    flame_candidate = cv2.morphologyEx(
        flame_candidate,
        cv2.MORPH_CLOSE,
        np.ones((15, 15), np.uint8),
    )
    if booster_active:
        flame_candidate = keep_effects_touching_character(
            flame_candidate,
            character_mask,
        )
        subject_alpha[y_coordinates > 510] = 0
    else:
        flame_candidate.fill(0)
    flame_strength = np.maximum(
        np.clip((blue_bias.astype(np.float32) - 5.0) / 20.0, 0.0, 1.0),
        np.clip((brightness_lift.astype(np.float32) - 3.0) / 20.0, 0.0, 1.0),
    )
    flame_alpha = (flame_strength * 255).astype(np.uint8)
    flame_alpha[flame_candidate == 0] = 0
    flame_alpha = cv2.GaussianBlur(flame_alpha, (0, 0), 0.65)

    subject_alpha[590:, :] = 0
    anchor_pixels = np.argwhere(subject_alpha > 160)
    if anchor_pixels.size == 0:
        raise RuntimeError("Cyberfred body anchor detection produced an empty frame.")
    anchor = {
        "x": width // 2,
        "y": int(anchor_pixels[:, 0].max()),
    }
    alpha = np.maximum(subject_alpha, flame_alpha)
    alpha[590:, :] = 0
    return np.dstack((frame, alpha)), anchor


def main() -> None:
    args = parse_args()
    if not args.source.is_file():
        raise FileNotFoundError(args.source)
    indices = selected_indices(args.start_frame, args.end_frame, args.frame_count)
    frames, fps = read_video_frames(args.source)
    if indices[-1] >= len(frames):
        raise RuntimeError(
            f"Cyberfred source ends at frame {len(frames) - 1}, requested {indices[-1]}.",
        )

    background = estimate_background(frames)
    segmenter = SubjectSegmenter(args.model)
    processed_with_anchors = [
        remove_background(
            frames[index],
            background,
            segmenter,
            booster_active=42 <= index <= 72,
        )
        for index in indices
    ]
    processed = [entry[0] for entry in processed_with_anchors]
    anchors = [entry[1] for entry in processed_with_anchors]
    rows = int(np.ceil(len(processed) / args.columns))
    atlas = np.zeros((rows * 640, args.columns * 640, 4), dtype=np.uint8)
    for output_index, frame in enumerate(processed):
        row, column = divmod(output_index, args.columns)
        atlas[row * 640:(row + 1) * 640, column * 640:(column + 1) * 640] = frame

    args.output.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(args.output), atlas):
        raise RuntimeError(f"Could not write Cyberfred atlas: {args.output}")

    metadata_path = args.metadata or args.output.with_suffix(".json")
    metadata_path.write_text(
        json.dumps(
            {
                "sourceFile": args.source.name,
                "sourceSha256": sha256(args.source),
                "sourceWidth": 640,
                "sourceHeight": 640,
                "sourceFps": fps,
                "sourceFrameCount": len(frames),
                "selectedFrames": indices,
                "columns": args.columns,
                "rows": rows,
                "frameCount": len(processed),
                "frameAnchors": anchors,
                "backgroundRemoval": "u2netp-subject-mask-plus-original-video-flame-isolation",
                "segmentationModel": {
                    "name": "u2netp",
                    "sha256": U2NETP_SHA256,
                },
                "anchorPreparation": "native-video-cells-for-shared-bottom-center-normalization",
            },
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
