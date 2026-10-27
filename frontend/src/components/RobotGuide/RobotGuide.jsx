// src/components/RobotGuide/RobotGuide.jsx
//
// The little assistant that walks a visitor through the site: the Pay Less,
// Shop More robot (waving, with a headset and a parcel).
//
// READ THIS FIRST
// ---------------
// It used to be drawn by hand in SVG. It is now the brand's own robot picture
// (src/images/robot/robot-helper.png, the full-size master), shown as small
// WebP copies so it stays light:
//
//     robot-helper-160.webp   ~11 KB   the small launcher and panel robots
//     robot-helper-320.webp   ~28 KB
//     robot-helper-480.webp   ~49 KB   the big robot on the Tutorial page
//
// The browser picks the right one by itself (srcSet + sizes below). To swap
// the picture again: replace the master PNG and make new WebP copies at the
// same three widths (sharp, as in scripts/optimize-images.js).
//
// A picture cannot move its mouth or arm the way the SVG could, so the same
// two props now animate the whole picture instead:
//   speaking  -> a soft glow pulses over the mouth, and the robot bobs a bit
//                faster - it reads as talking while the voice runs
//   waving    -> a friendly wiggle, for the greeting on the first step
// It always floats gently above a glow on the "ground". Anyone who asked for
// less motion (prefers-reduced-motion) gets a still robot.
//
// Everything here is decorative and hidden from screen readers. What the
// robot "says" is the step text on the page, which is real, selectable copy.

import robot160 from '../../images/robot/robot-helper-160.webp';
import robot320 from '../../images/robot/robot-helper-320.webp';
import robot480 from '../../images/robot/robot-helper-480.webp';
import styles from './RobotGuide.module.css';

/**
 * @param {object} props
 * @param {boolean} [props.speaking] the mouth glows and the robot bobs while true
 * @param {boolean} [props.waving] a greeting wiggle
 * @param {string} [props.className] sets the width; the height follows the picture
 */
export default function RobotGuide({ speaking = false, waving = false, className }) {
  const classes = [styles.robot, speaking && styles.isSpeaking, waving && styles.isWaving, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} aria-hidden="true">
      {/* Stays put while the robot floats above it, so the float reads as hover */}
      <span className={styles.glow} />

      <span className={styles.float}>
        <img
          className={styles.image}
          src={robot320}
          srcSet={`${robot160} 160w, ${robot320} 320w, ${robot480} 480w`}
          // The robot is shown at most 240px wide (the Tutorial page), and as
          // small as 48px (the help panel). The browser multiplies by the
          // screen's pixel density itself.
          sizes="(max-width: 600px) 60vw, 240px"
          alt=""
          // Same shape as the picture (1322 x 1190), so the page does not jump
          // when it loads.
          width="1322"
          height="1190"
          draggable="false"
          decoding="async"
        />
        {/* Over the mouth on the visor: pulses while the voice is speaking */}
        <span className={styles.mouthGlow} />
      </span>
    </span>
  );
}
