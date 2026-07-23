import type Phaser from "phaser";

import {
  WO_BESCHLUSS_ASSETS,
  applyWoBeschlussHit,
  createWoBeschlussState,
  woBeschlussDamageStageForHits,
  type WoBeschlussState,
} from "@/lib/wo-beschluss";

const CHARACTER_KEY = "wo-beschluss-reactions";
const INTERMEDIATE_KEY = "wo-beschluss-intermediate";
const CHARACTER_VARIANT_B_KEY = "wo-beschluss-reactions-variant-b";
const INTERMEDIATE_VARIANT_B_KEY = "wo-beschluss-intermediate-variant-b";
const CHARACTER_VARIANT_C_KEY = "wo-beschluss-reactions-variant-c";
const INTERMEDIATE_VARIANT_C_KEY = "wo-beschluss-intermediate-variant-c";
const GLOVE_KEY = "wo-beschluss-glove";
const GLOVE_PUNCH_ANIMATION = "wo-beschluss-glove-punch";
const FRAME_SIZE = 627;
const DEFORMATION_SLICE_COUNT = 13;
const SPEECH_LINES = ["Wo Beschluss?", "???", "Kommt noch was?", "Beschluss...", "keine Geldvollmacht..."] as const;
const DAMAGE_VARIANTS = [
  [
    { texture: CHARACTER_KEY, frame: 0 },
    { texture: CHARACTER_VARIANT_B_KEY, frame: 0 },
    { texture: CHARACTER_VARIANT_C_KEY, frame: 0 },
  ],
  [
    { texture: INTERMEDIATE_KEY, frame: 0 },
    { texture: INTERMEDIATE_VARIANT_B_KEY, frame: 0 },
    { texture: INTERMEDIATE_VARIANT_C_KEY, frame: 0 },
  ],
  [
    { texture: CHARACTER_KEY, frame: 1 },
    { texture: CHARACTER_VARIANT_B_KEY, frame: 1 },
    { texture: CHARACTER_VARIANT_C_KEY, frame: 1 },
  ],
  [
    { texture: INTERMEDIATE_KEY, frame: 1 },
    { texture: INTERMEDIATE_VARIANT_B_KEY, frame: 1 },
    { texture: INTERMEDIATE_VARIANT_C_KEY, frame: 1 },
  ],
  [
    { texture: CHARACTER_KEY, frame: 2 },
    { texture: CHARACTER_VARIANT_B_KEY, frame: 2 },
    { texture: CHARACTER_VARIANT_C_KEY, frame: 2 },
  ],
  [
    { texture: INTERMEDIATE_KEY, frame: 2 },
    { texture: INTERMEDIATE_VARIANT_B_KEY, frame: 2 },
    { texture: INTERMEDIATE_VARIANT_C_KEY, frame: 2 },
  ],
  [
    { texture: INTERMEDIATE_KEY, frame: 3 },
    { texture: INTERMEDIATE_VARIANT_B_KEY, frame: 3 },
    { texture: INTERMEDIATE_VARIANT_C_KEY, frame: 3 },
  ],
  [
    { texture: CHARACTER_KEY, frame: 3 },
    { texture: CHARACTER_VARIANT_B_KEY, frame: 3 },
    { texture: CHARACTER_VARIANT_C_KEY, frame: 3 },
  ],
] as const;

export type WoBeschlussSceneHandle = {
  resetRound(): void;
};

export function createWoBeschlussScene(
  PhaserRuntime: typeof Phaser,
  onStateChange: (state: WoBeschlussState) => void,
  onAssetsReady: () => void,
  onAssetsError: () => void,
): Phaser.Scene & WoBeschlussSceneHandle {
  class WoBeschlussScene extends PhaserRuntime.Scene implements WoBeschlussSceneHandle {
    private state: WoBeschlussState = createWoBeschlussState();
    private portrait!: Phaser.GameObjects.Sprite;
    private impactLayer!: Phaser.GameObjects.Graphics;
    private speechBubble!: Phaser.GameObjects.Container;
    private speechPanel!: Phaser.GameObjects.Graphics;
    private speechText!: Phaser.GameObjects.Text;
    private glove!: Phaser.GameObjects.Sprite;
    private deformationSlices: Phaser.GameObjects.Sprite[] = [];
    private speechHideTimer?: Phaser.Time.TimerEvent;
    private speechSide: 1 | -1 = 1;
    private lastSpeechIndex = -1;
    private lastDamageVariantByStage = Array<number>(DAMAGE_VARIANTS.length).fill(-1);
    private isHitAnimating = false;
    private isGlovePunching = false;
    private isPointerInside = false;
    private hasAssetLoadError = false;

    private pointerMoveHandler = (pointer: Phaser.Input.Pointer) => {
      this.isPointerInside = true;
      this.syncGloveToPointer(pointer);
    };

    private pointerEnterHandler = () => {
      this.isPointerInside = true;
      this.syncGloveToPointer(this.input.activePointer);
    };

    private pointerLeaveHandler = () => {
      this.isPointerInside = false;
      this.glove?.setVisible(false);
    };

    constructor() {
      super("wo-beschluss-game");
    }

    preload(): void {
      const sheet = { frameWidth: FRAME_SIZE, frameHeight: FRAME_SIZE };
      this.load.once(PhaserRuntime.Loader.Events.FILE_LOAD_ERROR, () => {
        this.hasAssetLoadError = true;
        onAssetsError();
      });
      this.load.spritesheet(CHARACTER_KEY, WO_BESCHLUSS_ASSETS.reactions, sheet);
      this.load.spritesheet(INTERMEDIATE_KEY, WO_BESCHLUSS_ASSETS.intermediate, sheet);
      this.load.spritesheet(CHARACTER_VARIANT_B_KEY, WO_BESCHLUSS_ASSETS.reactionsVariantB, sheet);
      this.load.spritesheet(INTERMEDIATE_VARIANT_B_KEY, WO_BESCHLUSS_ASSETS.intermediateVariantB, sheet);
      this.load.spritesheet(CHARACTER_VARIANT_C_KEY, WO_BESCHLUSS_ASSETS.reactionsVariantC, sheet);
      this.load.spritesheet(INTERMEDIATE_VARIANT_C_KEY, WO_BESCHLUSS_ASSETS.intermediateVariantC, sheet);
      this.load.spritesheet(GLOVE_KEY, WO_BESCHLUSS_ASSETS.glove, sheet);
    }

    create(): void {
      if (this.hasAssetLoadError) return;
      const { width, height } = this.scale;
      this.add.rectangle(width / 2, height / 2, width, height, 0xeef4f7);
      this.add.circle(width * 0.18, height * 0.22, 110, 0x286f9c, 0.09);
      this.add.circle(width * 0.82, height * 0.78, 150, 0xffd400, 0.16);

      this.portrait = this.add.sprite(width / 2, height / 2 + 18, CHARACTER_KEY, 0);
      this.portrait.setDisplaySize(Math.min(width * 0.82, 520), Math.min(width * 0.82, 520));
      this.portrait.setDepth(10);
      this.portrait.setInteractive({ cursor: "none", pixelPerfect: false });

      this.impactLayer = this.add.graphics().setDepth(20);
      this.speechPanel = this.add.graphics();
      this.speechText = this.add
        .text(0, 0, "", {
          color: "#211526",
          fontFamily: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif',
          fontSize: "19px",
          align: "center",
          lineSpacing: 2,
        })
        .setOrigin(0.5);
      this.speechBubble = this.add.container(0, 0, [this.speechPanel, this.speechText]);
      this.speechBubble.setDepth(40).setVisible(false);

      if (!this.anims.exists(GLOVE_PUNCH_ANIMATION)) {
        this.anims.create({
          key: GLOVE_PUNCH_ANIMATION,
          frames: [0, 1, 2, 3, 0].map((frame) => ({ key: GLOVE_KEY, frame })),
          frameRate: 18,
          repeat: 0,
        });
      }

      this.glove = this.add.sprite(width / 2, height / 2, GLOVE_KEY, 0);
      this.glove.setDisplaySize(this.gloveSize(width), this.gloveSize(width));
      this.glove.setDepth(100).setScrollFactor(0).setVisible(false);

      this.input.setDefaultCursor("none");
      this.input.on("pointermove", this.pointerMoveHandler);
      this.game.canvas.addEventListener("pointerenter", this.pointerEnterHandler);
      this.game.canvas.addEventListener("pointerleave", this.pointerLeaveHandler);
      this.portrait.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.handleHit(pointer));
      this.scale.on("resize", this.layout, this);
      this.events.once(PhaserRuntime.Scenes.Events.SHUTDOWN, this.teardown, this);
      onStateChange(this.state);
      onAssetsReady();
    }

    private teardown(): void {
      this.input.off("pointermove", this.pointerMoveHandler);
      this.game.canvas.removeEventListener("pointerenter", this.pointerEnterHandler);
      this.game.canvas.removeEventListener("pointerleave", this.pointerLeaveHandler);
      this.scale.off("resize", this.layout, this);
    }

    private layout(gameSize: Phaser.Structs.Size): void {
      const { width, height } = gameSize;
      this.portrait.setPosition(width / 2, height / 2 + 18);
      this.portrait.setDisplaySize(Math.min(width * 0.82, 520), Math.min(width * 0.82, 520));
      this.glove.setDisplaySize(this.gloveSize(width), this.gloveSize(width));
      if (this.speechBubble.visible) this.layoutSpeechBubble(width, height);
    }

    private handleHit(pointer: Phaser.Input.Pointer): void {
      if (this.state.finished || this.isHitAnimating) return;

      this.state = applyWoBeschlussHit(this.state);
      onStateChange(this.state);
      const direction = pointer.x < this.scale.width / 2 ? 1 : -1;
      this.playGlovePunch(pointer);
      this.showSpeechBubble(direction);
      this.applyDamageFrame();
      this.showImpact(pointer.x, pointer.y);
      this.cameras.main.flash(55, 255, 238, 190, false);
      this.cameras.main.shake(110, 0.009 + this.state.hits * 0.0009);
      this.animateFaceDeformation(direction);
    }

    private showSpeechBubble(side: 1 | -1): void {
      let nextIndex = PhaserRuntime.Math.Between(0, SPEECH_LINES.length - 1);
      while (nextIndex === this.lastSpeechIndex) {
        nextIndex = PhaserRuntime.Math.Between(0, SPEECH_LINES.length - 1);
      }
      this.lastSpeechIndex = nextIndex;
      this.speechSide = side;
      this.speechText.setText(SPEECH_LINES[nextIndex]);

      this.speechHideTimer?.remove(false);
      this.tweens.killTweensOf(this.speechBubble);
      this.layoutSpeechBubble(this.scale.width, this.scale.height);
      this.speechBubble.setVisible(true).setAlpha(0).setScale(0.72);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.tweens.add({
        targets: this.speechBubble,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        duration: reducedMotion ? 1 : 150,
        ease: "Back.Out",
      });
      this.speechHideTimer = this.time.delayedCall(1150, () => {
        this.tweens.add({
          targets: this.speechBubble,
          alpha: 0,
          y: this.speechBubble.y - (reducedMotion ? 0 : 8),
          duration: reducedMotion ? 1 : 190,
          ease: "Quad.In",
          onComplete: () => this.speechBubble.setVisible(false),
        });
      });
    }

    private layoutSpeechBubble(width: number, height: number): void {
      const bubbleWidth = PhaserRuntime.Math.Clamp(width * 0.28, 154, 214);
      const bubbleHeight = 88;
      const edgeGap = PhaserRuntime.Math.Clamp(width * 0.025, 12, 24);
      const x = this.speechSide > 0 ? width - bubbleWidth / 2 - edgeGap : bubbleWidth / 2 + edgeGap;
      const y = PhaserRuntime.Math.Clamp(height * 0.24, 74, 148);

      this.speechBubble.setPosition(x, y);
      this.speechText.setWordWrapWidth(bubbleWidth - 28);
      this.speechPanel.clear().fillStyle(0xfff5df, 0.98).lineStyle(3, 0x24172a, 1);
      if (this.speechSide > 0) {
        this.speechPanel.fillTriangle(-bubbleWidth / 2 + 8, bubbleHeight / 2 - 24, -bubbleWidth / 2 - 22, bubbleHeight / 2 + 8, -bubbleWidth / 2 + 40, bubbleHeight / 2 - 8);
        this.speechPanel.strokeTriangle(-bubbleWidth / 2 + 8, bubbleHeight / 2 - 24, -bubbleWidth / 2 - 22, bubbleHeight / 2 + 8, -bubbleWidth / 2 + 40, bubbleHeight / 2 - 8);
      } else {
        this.speechPanel.fillTriangle(bubbleWidth / 2 - 8, bubbleHeight / 2 - 24, bubbleWidth / 2 + 22, bubbleHeight / 2 + 8, bubbleWidth / 2 - 40, bubbleHeight / 2 - 8);
        this.speechPanel.strokeTriangle(bubbleWidth / 2 - 8, bubbleHeight / 2 - 24, bubbleWidth / 2 + 22, bubbleHeight / 2 + 8, bubbleWidth / 2 - 40, bubbleHeight / 2 - 8);
      }
      this.speechPanel.fillRoundedRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, 18);
      this.speechPanel.strokeRoundedRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, 18);
    }

    private gloveSize(width: number): number {
      return PhaserRuntime.Math.Clamp(width * 0.16, 92, 132);
    }

    private syncGloveToPointer(pointer: Phaser.Input.Pointer): void {
      if (!this.glove || !this.isPointerInside || this.state.finished || this.isGlovePunching) return;
      const comesFromLeft = pointer.x < this.scale.width / 2;
      this.glove.setPosition(pointer.x, pointer.y);
      this.glove.setFlipX(comesFromLeft);
      this.glove.setOrigin(comesFromLeft ? 0.88 : 0.12, 0.5);
      this.glove.setAngle(comesFromLeft ? 8 : -8).setVisible(true);
    }

    private playGlovePunch(pointer: Phaser.Input.Pointer): void {
      this.syncGloveToPointer(pointer);
      this.isGlovePunching = true;
      const contactX = pointer.x;
      const windUpOffset = pointer.x < this.scale.width / 2 ? -38 : 38;
      this.glove.setX(contactX + windUpOffset).play(GLOVE_PUNCH_ANIMATION, true);
      this.tweens.add({
        targets: this.glove,
        x: contactX,
        duration: 82,
        hold: 26,
        yoyo: true,
        ease: "Cubic.In",
        onComplete: () => this.glove.setX(contactX),
      });
      this.glove.once(PhaserRuntime.Animations.Events.ANIMATION_COMPLETE, () => {
        this.isGlovePunching = false;
        this.tweens.killTweensOf(this.glove);
        this.glove.setFrame(0);
        if (this.state.finished) this.glove.setVisible(false);
        else this.syncGloveToPointer(this.input.activePointer);
      });
    }

    private animateFaceDeformation(direction: number): void {
      this.clearDeformation();
      this.isHitAnimating = true;
      const baseX = this.portrait.x;
      const baseY = this.portrait.y;
      const textureKey = this.portrait.texture.key;
      const frameName = this.portrait.frame.name;
      const rawSliceWidth = FRAME_SIZE / DEFORMATION_SLICE_COUNT;
      let completedSlices = 0;
      this.portrait.setAlpha(0.26);

      for (let index = 0; index < DEFORMATION_SLICE_COUNT; index += 1) {
        const cropStart = Math.max(0, Math.floor(index * rawSliceWidth) - 1);
        const cropEnd = Math.min(FRAME_SIZE, Math.ceil((index + 1) * rawSliceWidth) + 1);
        const normalizedX = (index + 0.5) / DEFORMATION_SLICE_COUNT;
        const struckSideWeight = direction > 0 ? 1 - normalizedX : normalizedX;
        const faceCenterWeight = Math.sin(normalizedX * Math.PI);
        const push = direction * (8 + struckSideWeight * 31 + faceCenterWeight * 8);
        const twist = direction * (normalizedX - 0.5) * 15;
        const verticalKick = -5 * faceCenterWeight + twist;
        const slice = this.add.sprite(baseX, baseY, textureKey, frameName);
        slice.setDisplaySize(this.portrait.displayWidth, this.portrait.displayHeight);
        slice.setCrop(cropStart, 0, cropEnd - cropStart, FRAME_SIZE).setDepth(11);
        this.deformationSlices.push(slice);
        this.tweens.add({
          targets: slice,
          x: baseX + push,
          y: baseY + verticalKick,
          angle: direction * (2.5 + struckSideWeight * 3.5),
          duration: 105,
          delay: Math.round((1 - struckSideWeight) * 14),
          hold: 20,
          yoyo: true,
          ease: "Cubic.Out",
          onComplete: () => {
            completedSlices += 1;
            if (completedSlices === DEFORMATION_SLICE_COUNT) this.finishFaceDeformation(direction, baseX, baseY);
          },
        });
      }
    }

    private finishFaceDeformation(direction: number, baseX: number, baseY: number): void {
      for (const slice of this.deformationSlices) slice.destroy();
      this.deformationSlices = [];
      this.portrait.setAlpha(1).setPosition(baseX + direction * 18, baseY + 3).setAngle(direction * 4.5);
      this.tweens.add({
        targets: this.portrait,
        x: baseX,
        y: baseY,
        angle: 0,
        duration: 155,
        ease: "Back.Out",
        onComplete: () => {
          this.isHitAnimating = false;
          if (this.state.finished) {
            this.tweens.add({
              targets: this.portrait,
              y: this.portrait.y + 54,
              angle: direction * 8,
              alpha: 0.86,
              duration: 460,
              ease: "Back.In",
            });
          }
        },
      });
    }

    private clearDeformation(): void {
      this.tweens.killTweensOf(this.deformationSlices);
      for (const slice of this.deformationSlices) slice.destroy();
      this.deformationSlices = [];
      this.portrait?.setAlpha(1);
    }

    private showImpact(x: number, y: number): void {
      this.impactLayer.clear().fillStyle(0xffdf75, 0.95);
      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8;
        const inner = 18;
        const outer = index % 2 === 0 ? 58 : 42;
        this.impactLayer.fillTriangle(
          x + Math.cos(angle - 0.12) * inner,
          y + Math.sin(angle - 0.12) * inner,
          x + Math.cos(angle) * outer,
          y + Math.sin(angle) * outer,
          x + Math.cos(angle + 0.12) * inner,
          y + Math.sin(angle + 0.12) * inner,
        );
      }
      this.impactLayer.fillStyle(0xffffff, 1).fillCircle(x, y, 15);
      if (this.state.hits >= 2) {
        this.impactLayer.fillStyle(0xb9132b, 0.92);
        for (let index = 0; index < Math.min(3 + this.state.hits, 10); index += 1) {
          const dropAngle = -1.25 + index * 0.29;
          const distance = 34 + (index % 3) * 13;
          this.impactLayer.fillEllipse(
            x + Math.cos(dropAngle) * distance,
            y + Math.sin(dropAngle) * distance,
            5 + (index % 2) * 3,
            9 + (index % 3) * 2,
          );
        }
      }
      this.tweens.add({
        targets: this.impactLayer,
        alpha: 0,
        scale: 1.35,
        duration: 160,
        onComplete: () => this.impactLayer.setAlpha(1).setScale(1).clear(),
      });
    }

    private applyDamageFrame(): void {
      const stage = woBeschlussDamageStageForHits(this.state.hits);
      const variants = DAMAGE_VARIANTS[stage];
      let variantIndex = PhaserRuntime.Math.Between(0, variants.length - 1);
      while (variantIndex === this.lastDamageVariantByStage[stage]) {
        variantIndex = PhaserRuntime.Math.Between(0, variants.length - 1);
      }
      this.lastDamageVariantByStage[stage] = variantIndex;
      const damageFrame = variants[variantIndex];
      this.portrait.setTexture(damageFrame.texture, damageFrame.frame);
    }

    resetRound(): void {
      this.state = createWoBeschlussState();
      this.clearDeformation();
      this.isHitAnimating = false;
      this.isGlovePunching = false;
      this.lastDamageVariantByStage.fill(-1);
      this.speechHideTimer?.remove(false);
      this.speechHideTimer = undefined;
      this.tweens.killTweensOf(this.portrait);
      this.tweens.killTweensOf(this.glove);
      this.tweens.killTweensOf(this.speechBubble);
      this.cameras.main.resetFX();
      this.portrait.clearTint().setAlpha(1).setAngle(0).setTexture(CHARACTER_KEY, 0);
      this.portrait.setPosition(this.scale.width / 2, this.scale.height / 2 + 18);
      this.glove.stop().setFrame(0).setVisible(false);
      this.speechBubble.setVisible(false);
      this.impactLayer.clear();
      onStateChange(this.state);
    }
  }

  return new WoBeschlussScene();
}
