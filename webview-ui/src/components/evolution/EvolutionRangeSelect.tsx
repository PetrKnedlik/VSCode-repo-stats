import { InfoTooltip } from '../common/InfoTooltip';

const HISTORY_RANGE_OPTIONS = [
  { months: 0, label: 'All history' },
  { months: 1, label: 'Last month' },
  { months: 3, label: 'Last 3 months' },
  { months: 6, label: 'Last 6 months' },
  { months: 12, label: 'Last year' },
  { months: 24, label: 'Last 2 years' },
];

export function EvolutionRangeSelect({
  historyMonths,
  onHistoryMonthsChange,
  disabled,
}: {
  historyMonths: number;
  onHistoryMonthsChange: (months: number) => void;
  disabled?: boolean;
}) {
  const rangeOptions = HISTORY_RANGE_OPTIONS.some((option) => option.months === historyMonths)
    ? HISTORY_RANGE_OPTIONS
    : [...HISTORY_RANGE_OPTIONS, { months: historyMonths, label: `Last ${historyMonths} months` }];

  return (
    <label>
      <span>
        Date range
        <InfoTooltip
          content="Analyze only this part of history. All snapshots are spread across the range, so short ranges get finer detail and run faster. Changing it after a run marks the charts stale until you recompute."
          position="bottom"
        />
      </span>
      <select
        value={historyMonths}
        onChange={(event) => onHistoryMonthsChange(parseInt(event.target.value, 10))}
        disabled={disabled}
      >
        {rangeOptions.map((option) => (
          <option key={option.months} value={option.months}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
