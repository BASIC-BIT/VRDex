import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Globe2,
  List,
  PanelsTopLeft,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TimelineNavigation } from "@/lib/timeline/navigation";
import styles from "./timeline.module.css";
export function TimelineToolbar({
  navigation,
  date,
  timeZone,
  hour12,
  onNavigate,
  onDate,
  onPan,
  onNow,
}: {
  navigation: TimelineNavigation;
  date: string;
  timeZone: string;
  hour12: boolean;
  onNavigate: (next: Partial<TimelineNavigation>) => void;
  onDate: (value: string) => void;
  onPan: (hours: number) => void;
  onNow: () => void;
}) {
  return (
    <>
      <div className={styles.heading}>
        <h2 id="schedule-heading" tabIndex={-1}>
          Schedule
        </h2>
        <div className={styles.metadata}>
          <span>
            <Globe2 aria-label="Timezone" size={13} />
            {timeZone.replaceAll("_", " ")}
          </span>
          <span>
            <Clock3 aria-label="Hour format" size={13} />
            {hour12 ? "12h" : "24h"}
          </span>
        </div>
      </div>
      <div className={styles.toolbar}>
        <Button
          size="sm"
          aria-pressed={navigation.favoritesOnly}
          onClick={() =>
            onNavigate({ favoritesOnly: !navigation.favoritesOnly })
          }
        >
          <Star size={14} />
          Favorites only
        </Button>
        <div className={styles.views}>
          <Button
            size="sm"
            aria-pressed={navigation.view === "timeline"}
            onClick={() => onNavigate({ view: "timeline" })}
          >
            <PanelsTopLeft size={14} />
            Timeline
          </Button>
          <Button
            size="sm"
            aria-pressed={navigation.view === "agenda"}
            onClick={() => onNavigate({ view: "agenda" })}
          >
            <List size={14} />
            Agenda
          </Button>
        </div>
      </div>
      <div className={styles.navigation}>
        <input
          aria-label="Schedule date"
          type="date"
          min="0002-01-01"
          max="9998-12-31"
          value={date}
          onChange={(event) => onDate(event.target.value)}
        />
        <div>
          <Button size="sm" aria-label="Earlier" onClick={() => onPan(-3)}>
            <ChevronLeft size={14} />
            <span>Earlier</span>
          </Button>
          <Button size="sm" aria-label="Later" onClick={() => onPan(3)}>
            <span>Later</span>
            <ChevronRight size={14} />
          </Button>
          <Button size="sm" onClick={onNow}>
            Now
          </Button>
        </div>
      </div>
    </>
  );
}
