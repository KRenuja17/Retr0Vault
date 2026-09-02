import { useId } from "react";
import type { ReactNode, Ref } from "react";

import { MonoLabel } from "@/components/primitives";
import { cx } from "@/lib/cx";

import styles from "./Ingest.module.css";

interface FieldShellProps {
  readonly label: string;
  /** Mono marginalia printed opposite the label: OPTIONAL, REQUIRED, a count. */
  readonly note?: string | undefined;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  readonly className?: string | undefined;
}

interface FieldRenderProps extends FieldShellProps {
  readonly render: (props: {
    readonly id: string;
    readonly className: string | undefined;
    readonly "aria-describedby": string | undefined;
    readonly "aria-invalid": true | undefined;
  }) => ReactNode;
}

/**
 * One labelled control in an accession form: mono label, thin-ruled field, and
 * an error printed under it rather than as a floating notification.
 */
function Field({
  label,
  note,
  hint,
  error,
  className,
  render,
}: FieldRenderProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    cx(hint ? hintId : undefined, error ? errorId : undefined) ?? undefined;

  return (
    <div className={cx(styles.field, className)}>
      <div className={styles.fieldHead}>
        <label htmlFor={id}>
          <MonoLabel size="small" uppercase>
            {label}
          </MonoLabel>
        </label>
        {note ? (
          <MonoLabel size="micro" tone="muted" uppercase>
            {note}
          </MonoLabel>
        ) : null}
      </div>

      {render({
        id,
        className: cx(styles.control, error && styles.controlInvalid),
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}

      {hint ? (
        <MonoLabel id={hintId} size="micro" tone="muted" className={styles.fieldHint}>
          {hint}
        </MonoLabel>
      ) : null}
      {error ? (
        <MonoLabel id={errorId} size="micro" className={styles.fieldError}>
          {error}
        </MonoLabel>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends FieldShellProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: "text" | "url";
  readonly placeholder?: string | undefined;
  readonly disabled?: boolean;
  readonly autoComplete?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
}

export function TextField({
  value,
  onChange,
  type = "text",
  placeholder,
  disabled = false,
  autoComplete = "off",
  inputRef,
  ...shell
}: TextFieldProps) {
  return (
    <Field
      {...shell}
      render={(props) => (
        <input
          {...props}
          ref={inputRef}
          type={type}
          value={value}
          disabled={disabled}
          autoComplete={autoComplete}
          spellCheck={type === "url" ? false : undefined}
          {...(placeholder === undefined ? {} : { placeholder })}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    />
  );
}

export interface TextAreaFieldProps extends FieldShellProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly rows?: number;
  readonly disabled?: boolean;
  readonly mono?: boolean;
}

export function TextAreaField({
  value,
  onChange,
  rows = 4,
  disabled = false,
  mono = false,
  ...shell
}: TextAreaFieldProps) {
  return (
    <Field
      {...shell}
      render={(props) => (
        <textarea
          {...props}
          className={cx(props.className, mono && styles.controlMono)}
          rows={rows}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    />
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectFieldProps extends FieldShellProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly placeholderOption?: string | undefined;
  readonly disabled?: boolean;
}

export function SelectField({
  value,
  onChange,
  options,
  placeholderOption,
  disabled = false,
  ...shell
}: SelectFieldProps) {
  return (
    <Field
      {...shell}
      render={(props) => (
        <select
          {...props}
          className={cx(props.className, styles.select)}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {placeholderOption === undefined ? null : (
            <option value="">{placeholderOption}</option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    />
  );
}

export interface CheckFieldProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly hint?: string | undefined;
  readonly disabled?: boolean;
}

/** A square checkbox with a mono label; the archive has no toggles or switches. */
export function CheckField({
  label,
  checked,
  onChange,
  hint,
  disabled = false,
}: CheckFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={styles.check}>
      <input
        id={id}
        type="checkbox"
        className={styles.checkBox}
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id}>
        <MonoLabel size="small" uppercase>
          {label}
        </MonoLabel>
      </label>
      {hint ? (
        <MonoLabel id={hintId} size="micro" tone="muted" className={styles.checkHint}>
          {hint}
        </MonoLabel>
      ) : null}
    </div>
  );
}
