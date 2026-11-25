// Shared master-detail layout: a compact two-column list (title + date) beside the
// selected item's detail. Reusable for Insights, Videos and Work.
// - Uncontrolled by default (first item selected); pass selectedId + onSelect to control it
//   (e.g. to sync the selection with the URL).
// - renderDetail replaces the default summary card with any content (e.g. a full article).
// - layout="reader" gives a 1/3 list + 2/3 detail split with a sticky list on desktop.
// Narrow screens always stack: list first, then detail.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type ListDetailItem = {
  id: string;
  title: string;
  /** ISO date for <time dateTime>. */
  date: string;
  /** Short date shown in the list column. */
  dateLabel: string;
  /** Long date shown in the default detail card. */
  dateLong?: string;
  summary?: ReactNode;
  /** Extra facts shown next to the date in the default detail card (e.g. "5 min read"). */
  meta?: ReactNode[];
  /** Primary action for the default detail card (e.g. an Open link). */
  action?: ReactNode;
};

export type ListDetailContext = {
  /** id for the detail's heading; the detail region is labelled by it. */
  headingId: string;
};

type ListDetailProps<T extends ListDetailItem> = {
  items: T[];
  /** Accessible label for the list. */
  label: string;
  titleHeading?: string;
  dateHeading?: string;
  /** Uncontrolled initial selection. */
  initialId?: string;
  /** Controlled selection. */
  selectedId?: string;
  onSelect?: (id: string) => void;
  renderDetail?: (item: T, context: ListDetailContext) => ReactNode;
  layout?: "card" | "reader";
  className?: string;
};

export function ListDetail<T extends ListDetailItem>({
  items,
  label,
  titleHeading = "Title",
  dateHeading = "Date",
  initialId,
  selectedId: controlledId,
  onSelect,
  renderDetail,
  layout = "card",
  className,
}: ListDetailProps<T>) {
  const baseId = useId().replace(/:/g, "");
  const [internalId, setInternalId] = useState(initialId ?? items[0]?.id);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const detailRef = useRef<HTMLElement>(null);
  const userSelected = useRef(false);
  const currentId = controlledId ?? internalId;
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === currentId));
  const selected = items[selectedIndex];

  // After a user picks a different item, bring the top of the detail into view if it scrolled above the viewport
  // (long detail content, sticky list). On stacked mobile layouts the detail sits below, so nothing moves.
  useEffect(() => {
    if (!userSelected.current) return;
    userSelected.current = false;
    const detail = detailRef.current;
    if (!detail) return;
    const top = detail.getBoundingClientRect().top;
    if (top < 0) window.scrollTo({ top: window.scrollY + top - 16, behavior: "smooth" });
  }, [selected?.id]);

  if (!items.length || !selected) return null;
  const detailId = `${baseId}-detail`;
  const headingId = `${detailId}-title`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  // Click/Enter on the already-selected row still reports it (a controlled parent may want to, e.g., put it in the URL);
  // arrow keys that land on the same row (list edges) do nothing.
  const select = (index: number, via: "pointer" | "keys" = "pointer") => {
    const next = Math.min(items.length - 1, Math.max(0, index));
    const id = items[next].id;
    optionRefs.current[next]?.focus();
    if (id === selected.id && via === "keys") return;
    if (id !== selected.id) userSelected.current = true;
    if (controlledId === undefined) setInternalId(id);
    onSelect?.(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowDown: selectedIndex + 1, ArrowUp: selectedIndex - 1, Home: 0, End: items.length - 1 };
    if (event.key in keys) {
      event.preventDefault();
      select(keys[event.key], "keys");
    }
  };

  return (
    <div className={["list-detail", `list-detail--${layout}`, className].filter(Boolean).join(" ")}>
      <div className="list-detail-list">
        <div className="list-detail-head" aria-hidden="true">
          <span>{titleHeading}</span>
          <span>{dateHeading}</span>
        </div>
        <div role="listbox" aria-label={label} aria-controls={detailId} className="list-detail-rows" onKeyDown={onKeyDown}>
          {items.map((item, index) => {
            const isSelected = index === selectedIndex;
            return (
              <div
                key={item.id}
                id={optionId(index)}
                ref={(element) => { optionRefs.current[index] = element; }}
                role="option"
                aria-selected={isSelected}
                aria-controls={detailId}
                tabIndex={isSelected ? 0 : -1}
                className={`list-detail-row${isSelected ? " is-selected" : ""}`}
                onClick={() => select(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select(index);
                  }
                }}
              >
                <span className="list-detail-row-title">{item.title}</span>
                <time className="list-detail-row-date" dateTime={item.date}>{item.dateLabel}</time>
              </div>
            );
          })}
        </div>
      </div>
      <section id={detailId} ref={detailRef} className="list-detail-detail" aria-labelledby={headingId}>
        {renderDetail ? renderDetail(selected, { headingId }) : (
          <>
            <h2 id={headingId} className="list-detail-title">{selected.title}</h2>
            <p className="list-detail-meta">
              <time dateTime={selected.date}>{selected.dateLong ?? selected.dateLabel}</time>
              {selected.meta?.map((fact, index) => <span key={index}>{fact}</span>)}
            </p>
            {selected.summary && <p className="list-detail-summary">{selected.summary}</p>}
            {selected.action && <div className="list-detail-action">{selected.action}</div>}
          </>
        )}
      </section>
    </div>
  );
}
