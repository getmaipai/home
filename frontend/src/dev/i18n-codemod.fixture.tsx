declare const name: string;
declare const other: string;
declare const toast: { error(message: string): void };
declare function setError(message: string): void;
export const fixture = <button title="Save changes">Save changes</button>;
export const spaced = <p>Hello <b>{name}</b> and {other} are here, and
  this wraps &amp; folds.</p>;
export const notify = () => { toast.error("Could not save"); setError("Try again"); };
declare const ok: boolean;
export const pick = <i>{ok ? "Yes please" : "No thanks"}</i>;
