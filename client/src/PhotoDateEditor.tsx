import { useEffect, useRef, useState } from "react";
import {
  exactDateInputValue,
  fieldsFromExactDateInput,
  fieldsFromStored,
  storedFromFields,
  type PhotoDateFields,
  type PhotoDateKind,
} from "./photo-date";

const MONTH_OPTIONS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

export function PhotoDateEditor({
  storedDate,
  onSave,
}: {
  storedDate: string | undefined;
  onSave: (date: string) => void | Promise<void>;
}) {
  const [fields, setFields] = useState<PhotoDateFields>(() => fieldsFromStored(storedDate));
  const storedRef = useRef(storedDate?.trim() ?? "");

  useEffect(() => {
    storedRef.current = storedDate?.trim() ?? "";
    setFields(fieldsFromStored(storedDate));
  }, [storedDate]);

  function commit() {
    const next = storedFromFields(fields);
    if (next === storedRef.current) return;
    storedRef.current = next;
    void onSave(next);
  }

  function setKind(kind: PhotoDateKind) {
    setFields((prev) => ({ ...prev, kind }));
  }

  const preview = storedFromFields(fields);
  const previewLabel = preview || "—";

  return (
    <div className="photo-date-editor">
      <label className="photo-date-kind">
        <span>Date type</span>
        <select
          value={fields.kind}
          onChange={(e) => setKind(e.target.value as PhotoDateKind)}
          onBlur={commit}
        >
          <option value="year">Year only</option>
          <option value="month">Year and month</option>
          <option value="exact">Exact date</option>
          <option value="range">Year range</option>
          <option value="circa">Circa (approximate)</option>
        </select>
      </label>

      {fields.kind === "year" && (
        <label>
          Year
          <input
            type="number"
            className="date-part-input"
            min={1000}
            max={9999}
            placeholder="e.g. 1960"
            value={fields.year}
            onChange={(e) => setFields((f) => ({ ...f, year: e.target.value }))}
            onBlur={commit}
          />
        </label>
      )}

      {fields.kind === "month" && (
        <div className="photo-date-row">
          <label>
            Year
            <input
              type="number"
              className="date-part-input"
              min={1000}
              max={9999}
              value={fields.year}
              onChange={(e) => setFields((f) => ({ ...f, year: e.target.value }))}
              onBlur={commit}
            />
          </label>
          <label>
            Month
            <select
              value={fields.month}
              onChange={(e) => setFields((f) => ({ ...f, month: e.target.value }))}
              onBlur={commit}
            >
              <option value="">—</option>
              {MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {fields.kind === "exact" && (
        <label>
          Date
          <input
            type="date"
            className="date-input"
            value={exactDateInputValue(fields)}
            onChange={(e) => setFields((f) => fieldsFromExactDateInput(e.target.value, f))}
            onBlur={commit}
          />
        </label>
      )}

      {fields.kind === "range" && (
        <div className="photo-date-row">
          <label>
            From year
            <input
              type="number"
              className="date-part-input"
              min={1000}
              max={9999}
              value={fields.year}
              onChange={(e) => setFields((f) => ({ ...f, year: e.target.value }))}
              onBlur={commit}
            />
          </label>
          <label>
            To year
            <input
              type="number"
              className="date-part-input"
              min={1000}
              max={9999}
              value={fields.yearEnd}
              onChange={(e) => setFields((f) => ({ ...f, yearEnd: e.target.value }))}
              onBlur={commit}
            />
          </label>
        </div>
      )}

      {fields.kind === "circa" && (
        <label>
          Approximate year
          <input
            type="number"
            className="date-part-input"
            min={1000}
            max={9999}
            placeholder="e.g. 1960"
            value={fields.year}
            onChange={(e) => setFields((f) => ({ ...f, year: e.target.value }))}
            onBlur={commit}
          />
        </label>
      )}

      <p className="field-hint photo-date-preview">
        Stored as: <span className="photo-date-preview-value">{previewLabel}</span>
      </p>
    </div>
  );
}
