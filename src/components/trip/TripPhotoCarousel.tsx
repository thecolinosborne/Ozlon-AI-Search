import { useState, useRef } from "react";
import { cn } from "@/lib/utils";

export const TripPhotoCarousel = ({ photos, height = "h-44" }: { photos: string[]; height?: string }) => {
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  if (!photos?.length) return null;
  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / el.clientWidth);
          if (i !== idx) setIdx(i);
        }}
        className={cn(
          "flex overflow-x-auto snap-x snap-mandatory scrollbar-hide rounded-xl",
          height,
        )}
        style={{ scrollbarWidth: "none" }}
      >
        {photos.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            loading="lazy"
            className="w-full flex-shrink-0 snap-center object-cover"
          />
        ))}
      </div>
      {photos.length > 1 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
          {photos.map((_, i) => (
            <span key={i} className={cn(
              "w-1.5 h-1.5 rounded-full transition-all",
              i === idx ? "bg-white w-4" : "bg-white/50",
            )} />
          ))}
        </div>
      )}
    </div>
  );
};
