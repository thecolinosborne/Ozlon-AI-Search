// Phase 2 scaffold — 1:1 square template
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";

export const SquareTemplate: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" }}>
      <div style={{ opacity, color: "#fff", fontSize: 64, fontWeight: "bold", textAlign: "center", padding: 40 }}>
        Square Template
      </div>
    </AbsoluteFill>
  );
};
