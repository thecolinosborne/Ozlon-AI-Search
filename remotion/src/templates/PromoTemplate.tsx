// Phase 2 scaffold — 16:9 landscape promo template
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";

export const PromoTemplate: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" }}>
      <div style={{ opacity, color: "#fff", fontSize: 72, fontWeight: "bold", textAlign: "center", padding: 60 }}>
        Promo Template
      </div>
    </AbsoluteFill>
  );
};
