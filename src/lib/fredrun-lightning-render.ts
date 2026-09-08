import {
  FREDRUN_GROUND_Y,
  FREDRUN_LIGHTNING_HEIGHT,
  FREDRUN_LIGHTNING_WARNING_SECONDS,
  FREDRUN_LIGHTNING_WIDTH,
  FREDRUN_PLAYER_X,
  type FredRunLightning,
} from "./fredrun";

export function drawFredRunLightning(
  context: CanvasRenderingContext2D,
  hazard: FredRunLightning,
  reducedMotion: boolean,
): void {
  const warning = hazard.age < FREDRUN_LIGHTNING_WARNING_SECONDS;
  const center = hazard.x + FREDRUN_LIGHTNING_WIDTH / 2;
  const ground = FREDRUN_GROUND_Y;
  context.save();
  context.globalAlpha = hazard.absorbed ? 0.35 : 1;
  context.fillStyle = warning ? "#382c00" : "#123c59";
  context.fillRect(hazard.x, ground - FREDRUN_LIGHTNING_HEIGHT, FREDRUN_LIGHTNING_WIDTH, FREDRUN_LIGHTNING_HEIGHT);
  context.strokeStyle = warning ? "#ffe36a" : "#75eaff";
  context.lineWidth = 2;
  context.strokeRect(hazard.x, ground - FREDRUN_LIGHTNING_HEIGHT, FREDRUN_LIGHTNING_WIDTH, FREDRUN_LIGHTNING_HEIGHT);

  // A solid target and German instruction remain readable without flashing.
  context.font = "bold 12px sans-serif";
  context.textAlign = "center";
  context.fillStyle = "#101820";
  context.fillRect(center - 69, ground - 65, 138, 23);
  context.fillStyle = "#fff4ad";
  context.fillText(hazard.absorbed ? "ABGEFANGEN" : warning ? "BLITZ – SPRINGEN!" : "SPRINGEN!", center, ground - 49);
  if (warning) {
    const progress = reducedMotion ? 1 : hazard.age / FREDRUN_LIGHTNING_WARNING_SECONDS;
    context.fillRect(hazard.x, ground - 29, FREDRUN_LIGHTNING_WIDTH * progress, 4);
  }

  // Only the short ground discharge collides. The tall bolt strikes visibly
  // ahead and disappears before reaching the player's fixed horizontal lane.
  const striking = !warning && !hazard.absorbed;
  const tallBolt = striking && !reducedMotion
    && hazard.age < FREDRUN_LIGHTNING_WARNING_SECONDS + 0.12
    && hazard.x > FREDRUN_PLAYER_X + 64;
  const top = tallBolt ? 8 : ground - 111;
  const bottom = tallBolt ? ground : ground - 72;
  context.beginPath();
  context.moveTo(center + 8, top);
  context.lineTo(center - 11, top + (bottom - top) * 0.36);
  context.lineTo(center + 7, top + (bottom - top) * 0.33);
  context.lineTo(center - 9, top + (bottom - top) * 0.72);
  context.lineTo(center + 5, top + (bottom - top) * 0.66);
  context.lineTo(center, bottom);
  context.strokeStyle = "#67dcff";
  context.lineWidth = tallBolt ? 7 : 4;
  context.stroke();
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2;
  context.stroke();

  if (striking) {
    context.beginPath();
    context.moveTo(hazard.x, ground - 7);
    for (let point = 1; point <= 8; point += 1) {
      context.lineTo(hazard.x + point * FREDRUN_LIGHTNING_WIDTH / 8, ground - (point % 2 ? 18 : 5));
    }
    context.strokeStyle = "#b9f8ff";
    context.lineWidth = 3;
    context.stroke();
  }
  context.restore();
}
