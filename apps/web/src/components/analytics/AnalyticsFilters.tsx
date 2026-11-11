import { CalendarRange } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SelectField } from "@/components/ui/SelectField";
import {
  ANALYTICS_RANGE_PRESETS,
  analyticsPresetRange,
  daysBetweenIso,
  getBrowserTimeZone,
  type AnalyticsFilterState,
  type AnalyticsRangePreset,
} from "@/lib/analytics";
import type { AnalyticsGrouping } from "@subscript/shared";

interface AnalyticsFiltersProps {
  value: AnalyticsFilterState;
  onChange: (value: AnalyticsFilterState) => void;
}

const BROWSER_TIME_ZONE = getBrowserTimeZone();
const TIMEZONE_OPTIONS =
  BROWSER_TIME_ZONE === "UTC"
    ? [{ value: "UTC", label: "UTC" }]
    : [
        { value: "UTC", label: "UTC" },
        { value: BROWSER_TIME_ZONE, label: `Local · ${BROWSER_TIME_ZONE}` },
      ];

function fitGrouping(
  grouping: AnalyticsGrouping,
  days: number,
): AnalyticsGrouping {
  if (grouping === "day" && days > 120) {
    return days > 740 ? "month" : "week";
  }

  if (grouping === "week" && days > 840) {
    return "month";
  }

  return grouping;
}

function groupingOptions(days: number): Array<{
  value: AnalyticsGrouping;
  label: string;
}> {
  const options: Array<{ value: AnalyticsGrouping; label: string }> = [];

  if (days <= 120) {
    options.push({ value: "day", label: "Daily" });
  }

  if (days <= 840) {
    options.push({ value: "week", label: "Weekly" });
  }

  options.push({ value: "month", label: "Monthly" });

  return options;
}

function DateField({
  label,
  value,
  max,
  min,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold tracking-[-0.005em] text-ink">
        {label}
      </span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-12 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[13px] text-ink shadow-[inset_0_1px_0_rgba(23,23,18,0.02)] outline-none transition-[border-color,box-shadow] duration-200 focus:border-ink focus:ring-2 focus:ring-lime/65"
      />
    </label>
  );
}

export function AnalyticsFilters({ value, onChange }: AnalyticsFiltersProps) {
  const days = daysBetweenIso(value.from, value.to);
  const groupOptions = groupingOptions(days);

  function update(next: Partial<AnalyticsFilterState>): void {
    const merged = { ...value, ...next };
    const nextDays = daysBetweenIso(merged.from, merged.to);
    onChange({
      ...merged,
      grouping: fitGrouping(merged.grouping, nextDays),
    });
  }

  function changePreset(preset: AnalyticsRangePreset): void {
    if (preset === "custom") {
      onChange({ ...value, preset });
      return;
    }

    const range = analyticsPresetRange(preset);
    const grouping: AnalyticsGrouping =
      preset === "30d"
        ? "day"
        : preset === "90d"
          ? "week"
          : "month";

    onChange({ ...value, ...range, preset, grouping });
  }

  function changeFrom(from: string): void {
    if (!from) {
      return;
    }

    update({
      from,
      to: from > value.to ? from : value.to,
      preset: "custom",
    });
  }

  function changeTo(to: string): void {
    if (!to) {
      return;
    }

    update({
      from: to < value.from ? to : value.from,
      to,
      preset: "custom",
    });
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CalendarRange
            aria-hidden="true"
            className="h-4 w-4 text-muted"
            strokeWidth={1.8}
          />
          <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
            Reporting window
          </h2>
        </div>
        <p className="text-[11px] leading-5 text-muted">
          {days} {days === 1 ? "day" : "days"} · amounts stay in their original
          currency
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SelectField
          label="Range"
          value={value.preset}
          onChange={(next) => changePreset(next as AnalyticsRangePreset)}
          options={ANALYTICS_RANGE_PRESETS}
        />
        <DateField
          label="From"
          value={value.from}
          max={value.to}
          onChange={changeFrom}
        />
        <DateField
          label="To"
          value={value.to}
          min={value.from}
          onChange={changeTo}
        />
        <SelectField
          label="Group by"
          value={value.grouping}
          onChange={(next) => update({ grouping: next as AnalyticsGrouping })}
          options={groupOptions}
        />
        <SelectField
          label="Timezone"
          value={value.timezone}
          onChange={(timezone) => update({ timezone })}
          options={TIMEZONE_OPTIONS}
        />
      </div>

      {days > 120 ? (
        <p className="mt-3 text-[10.5px] leading-5 text-muted">
          Daily grouping is available for ranges up to 120 days.
        </p>
      ) : null}
    </Card>
  );
}
