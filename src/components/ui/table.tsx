"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

type TableProps = React.HTMLAttributes<HTMLTableElement> & { scrollLabel?: string };

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, scrollLabel, ...props }, ref) => {
    const viewport = React.useRef<HTMLDivElement>(null);
    const [scroll, setScroll] = React.useState({ left: 0, max: 0 });
    const measure = React.useCallback(() => {
      const element = viewport.current;
      if (!element) return;
      const max = Math.max(0, element.scrollWidth - element.clientWidth);
      const left = Math.max(0, Math.min(element.scrollLeft, max));
      setScroll((previous) =>
        previous.left === left && previous.max === max ? previous : { left, max }
      );
    }, []);

    React.useEffect(() => {
      if (!scrollLabel || !viewport.current) return;
      const observer = new ResizeObserver(measure);
      observer.observe(viewport.current);
      if (viewport.current.firstElementChild) observer.observe(viewport.current.firstElementChild);
      const frame = requestAnimationFrame(measure);
      return () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
      };
    }, [measure, scrollLabel]);

    const move = (left: number) => {
      if (viewport.current) viewport.current.scrollLeft = left;
      measure();
    };
    const overflows = !!scrollLabel && scroll.max > 1;
    return (
      <div className="min-w-0 max-w-full">
        {overflows && (
          <div className="mb-3 rounded-md border border-input bg-muted/40 px-3 py-2">
            <p className="mb-1 text-xs text-muted-foreground">
              Weitere Spalten: horizontal verschieben
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label={`${scrollLabel}: nach links`}
                disabled={scroll.left <= 1}
                onClick={() => move(scroll.left - (viewport.current?.clientWidth || 250) * 0.8)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-background disabled:opacity-35"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <input
                type="range"
                aria-label={`${scrollLabel}: horizontale Position`}
                aria-valuetext={`${Math.round((scroll.left / scroll.max) * 100)} Prozent`}
                min={0}
                max={scroll.max}
                step={1}
                value={scroll.left}
                onChange={(event) => move(Number(event.target.value))}
                className="h-9 min-w-0 w-full cursor-pointer accent-primary"
              />
              <button
                type="button"
                aria-label={`${scrollLabel}: nach rechts`}
                disabled={scroll.left >= scroll.max - 1}
                onClick={() => move(scroll.left + (viewport.current?.clientWidth || 250) * 0.8)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-background disabled:opacity-35"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        <div
          ref={viewport}
          onScroll={scrollLabel ? measure : undefined}
          role={overflows ? "region" : undefined}
          aria-label={overflows ? scrollLabel : undefined}
          tabIndex={overflows ? 0 : undefined}
          className="relative w-full overflow-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-ring"
        >
          <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
        </div>
      </div>
    );
  }
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
