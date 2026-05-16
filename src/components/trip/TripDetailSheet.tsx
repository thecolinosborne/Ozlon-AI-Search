import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ExternalLink, MapPin } from "lucide-react";
import { TripPhotoCarousel } from "./TripPhotoCarousel";
import type { Flight, Stay, TripEvent } from "./types";

type DetailItem =
  | { kind: "flight"; data: Flight }
  | { kind: "stay"; data: Stay }
  | { kind: "event"; data: TripEvent };

export const TripDetailSheet = ({ open, onClose, item }: {
  open: boolean;
  onClose: () => void;
  item: DetailItem | null;
}) => {
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        {item?.kind === "stay" && (
          <>
            <TripPhotoCarousel photos={item.data.photos} height="h-56" />
            <DrawerHeader>
              <DrawerTitle>{item.data.name}</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6 space-y-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="w-4 h-4" /> {item.data.neighborhood} · ★ {item.data.rating.toFixed(1)} ({item.data.reviews})
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold">${item.data.per_night_usd}</span>
                <span className="text-muted-foreground">/ night · ${item.data.total_usd} total</span>
              </div>
              <a
                href={item.data.deep_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 px-4 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium"
              >
                Book on {item.data.kind === "hotel" ? "Booking.com" : "Airbnb"} <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </>
        )}
        {item?.kind === "flight" && (
          <>
            <DrawerHeader>
              <DrawerTitle>{item.data.airline} {item.data.flight_number}</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6 space-y-3 text-sm">
              <div className="text-muted-foreground tabular-nums">
                {item.data.origin_code} {item.data.depart_time} → {item.data.dest_code} {item.data.arrive_time}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold">${item.data.price_usd}</span>
                <span className="text-muted-foreground">vs typical ${item.data.baseline_usd}</span>
              </div>
              <a
                href={item.data.deep_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 px-4 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium"
              >
                View on Google Flights <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </>
        )}
        {item?.kind === "event" && (
          <>
            <img src={item.data.photo} alt="" className="w-full h-44 object-cover" />
            <DrawerHeader>
              <DrawerTitle>{item.data.title}</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6 space-y-3 text-sm">
              <div className="text-muted-foreground">{item.data.when} · ${item.data.price_usd}</div>
              <a
                href={item.data.deep_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 px-4 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium"
              >
                See details <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
};
