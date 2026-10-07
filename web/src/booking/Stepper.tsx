export function Stepper(props: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const { label, value, min, max, onChange } = props;
  return (
    <div>
      <label>{label}</label>
      <div className="stepper">
        <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <span aria-live="polite">{value}</span>
        <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}
