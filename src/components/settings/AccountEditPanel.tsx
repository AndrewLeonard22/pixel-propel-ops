/**
 * Editing one ad account's mapping. A right-side Sheet, and that choice is a measurement,
 * not a preference.
 *
 * ⛔ INLINE EDITING CANNOT FIT, and that is @andrew's "there's like cutoffs and stuff on
 * it". The old edit row was `flex flex-wrap` over fixed widths:
 *     180 name + 190 company + 150 program + 130 buyer + 110 status + 82 buttons + 40 gaps
 *   = 882px inside a 864px content box.
 * Flexbox breaks on HYPOTHETICAL main size, before any shrinking, so it wrapped at EVERY
 * desktop width: the button group dropped to a second line, landed alone ~250px from the
 * field it commits, and the row grew from 60px to ~100px, shoving all 51 rows below it
 * down. Not an edge case. The default.
 *
 * ⛔ A MODAL LOSES for a different reason: the task is COMPARATIVE. Many Meta names are
 * "<Client> X SocialWorks" variants and you decide what to type by reading the rows around
 * this one. A modal covers exactly the information the decision needs.
 *
 * ⭐ THE SHEET WINS on all three counts: the table stays visible with the source row held
 * in a selected state, the controls get full width and real labels, and there is room for
 * the decision-support block (account id, first/last seen, 30d spend) that says what this
 * account actually IS.
 */
import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Combobox } from '@/components/ui/combobox';
import { Segmented } from '@/components/ui/segmented';
import { Loader2, X } from 'lucide-react';
import { classifyMapping, displayCompany, displayMetaName, formatMoney } from '@/lib/accountDisplay';
import type { AdAccount } from './AccountsTable';

// Typed as plain strings rather than `as const`: the state these drive is `string | null`
// (it comes from a nullable text column), and a literal-union option list forced a cast at
// the call site that then hid the null the control now has to be able to produce.
const PROGRAMS: readonly { value: string; label: string }[] = [
  { value: 'Done For You', label: 'Done For You' },
  { value: 'Done With You', label: 'Done With You' },
  { value: 'Internal', label: 'Internal' },
];

/**
 * ⚠️ TWO CELLS, NOT THREE. The live table holds `active` (51) and `archived` (1). `paused`
 * appears in ZERO rows and the legacy settings screen used a different casing again
 * (Active/Paused/Churned). Rendering a third cell that nothing can ever be is a control
 * offering a state the system does not have.
 */
const STATUSES: readonly { value: string; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

/**
 * ⛔ NO LOCAL `money` HERE. There used to be one, defined `n == null ? '—' : …`, while the
 * table defined a function of the same name as `!n ? '—' : …`. `!0` is true, so the same
 * account read "—" in the table and "$0" in this panel one click later. Both now call the
 * single implementation in lib/accountDisplay.
 */
const shortDate = (s: string | null | undefined) =>
  !s ? '—' : new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * ⚠️ A `<label>` WITH NO `for` AND NO NESTED CONTROL LABELS NOTHING. Three of the four
 * fields here were exactly that: Program, Media buyer and Status rendered a bare `<label>`
 * pointing at no id, so a screen reader announced the group and never the name of the
 * control inside it. Every field now either passes `htmlFor` (and the control carries that
 * id) or renders a plain `<span>`, which at least does not CLAIM to be a label.
 *
 * 🔴 AND THAT RULE WAS STATED HERE AND THEN BROKEN 214 LINES BELOW. "Media buyer" shipped
 * as a bare `<span>` over a `<Combobox>` that DID have an id — the one case the comment
 * above says must pass `htmlFor` — so axe-core reported `button-name`, impact CRITICAL, on
 * the live sheet. It looked fine because the trigger's text content is the selected value
 * ("Jez"); see the `aria-label` docblock in ui/combobox.tsx for why content does not name a
 * `role="combobox"`.
 *
 * ⭐ The label now also carries an `id`, and the control points back at it with
 * `aria-labelledby`. `<label for>` alone SHOULD name a button (a button is a labelable
 * element) but that path runs through the host-language step of the accname algorithm,
 * which UAs implement unevenly for elements carrying an overriding `role`. An explicit
 * `aria-labelledby` is the same string by construction — it references this very node — and
 * it cannot be skipped. Belt and braces on the one field that names a client.
 */
function Field({ label, hint, htmlFor, children }: {
  label: string; hint?: string; htmlFor?: string; children: React.ReactNode;
}) {
  const cls = 'block text-[13px] font-medium text-foreground';
  return (
    <div className="space-y-2">
      {htmlFor
        ? <label id={`${htmlFor}-label`} htmlFor={htmlFor} className={cls}>{label}</label>
        : <span className={cls}>{label}</span>}
      {children}
      {hint && <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>}
    </div>
  );
}

function Ref({ label, value, mono, className }: { label: string; value: string; mono?: boolean; className?: string }) {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate text-[13px] text-foreground ${mono ? 'font-mono-tabular' : ''}`} title={value}>
        {value}
      </div>
    </div>
  );
}

export interface AccountEditPanelProps {
  account: AdAccount | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Existing values, so the comboboxes converge instead of minting near-duplicates. */
  companies: string[];
  buyers: string[];
  onSave: (id: string, patch: Partial<AdAccount>) => Promise<string | null>;
}

export default function AccountEditPanel({
  account, open, onOpenChange, companies, buyers, onSave,
}: AccountEditPanelProps) {
  const [company, setCompany] = useState('');
  const [program, setProgram] = useState<string | null>(null);
  const [buyer, setBuyer] = useState<string | null>(null);
  const [status, setStatus] = useState('active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 🔴 CANCEL DID NOT DISCARD THE DRAFT, and the next click could commit it.
   *
   * This effect keyed on `[account]` by OBJECT IDENTITY. `openRow(r)` passes the same object
   * out of the memoised `filtered` array every time, and this component never unmounts —
   * only Radix's `SheetContent` does. So: open a row, type a new company name, press Cancel,
   * reopen the SAME row. `account` is identical, the effect does not re-run, the box still
   * holds the abandoned text, `dirty` is still true and "Save changes" is still armed. One
   * stray click writes an edit the user explicitly cancelled, to the column the entire
   * screen exists to protect.
   *
   * ⭐ The trigger is OPENING, not the identity of the prop. `account?.account_id` rather
   * than `account` for the same reason: the row object is replaced on every save, and
   * comparing the id compares the thing that actually identifies the account.
   */
  useEffect(() => {
    if (!open || !account) return;
    // An unmapped row opens with an EMPTY company box, never pre-filled with the junk that
    // made it unmapped. Pre-filling "10170221, USD" invites a save that re-commits it.
    setCompany(displayCompany(account) ?? '');
    setProgram(account.program ?? null);
    setBuyer(account.media_buyer ?? null);
    setStatus(account.status || 'active');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.account_id]);

  /**
   * ⭐ "Save changes" MUST BE ABLE TO SAY THERE ARE NONE. It was permanently enabled, so
   * the button gave no signal about whether anything had been edited, and pressing it on
   * an untouched `unconfirmed` row was indistinguishable from pressing it on a real edit.
   * Confirming an auto-copied name IS a real action though, so that one case stays live
   * and gets its own label instead of being disabled.
   */
  const dirty = useMemo(() => {
    if (!account) return false;
    return (
      (company.trim() || null) !== (displayCompany(account) ?? null) ||
      (program || null) !== (account.program ?? null) ||
      (buyer?.trim() || null) !== (account.media_buyer ?? null) ||
      (status || 'active') !== (account.status || 'active')
    );
  }, [account, company, program, buyer, status]);

  if (!account) return null;

  const state = classifyMapping(account);
  const metaName = displayMetaName(account);
  const canSave = dirty || state === 'unconfirmed';

  const commit = async () => {
    setSaving(true);
    setError(null);
    const msg = await onSave(account.account_id, {
      company_name: company.trim() || null,
      program: program || null,
      media_buyer: buyer?.trim() || null,
      status: status || 'active',
    });
    setSaving(false);
    if (msg) setError(msg);
    else onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // ⛔ The primitive's own close button is suppressed: this panel draws one in its
        // header rail, and both were rendering, overlapping into a doubled X on every open.
        showClose={false}
        className="w-full sm:max-w-[420px] p-0 flex flex-col gap-0"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(); }
        }}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-divider">
          <div className="min-w-0">
            {/* ⚠️ `SheetTitle` and not a raw `<h2>`. Radix requires a Title inside a Dialog
                Content and logs a violation without one, and more importantly the dialog
                had NO ACCESSIBLE NAME: a screen reader announced "dialog" and nothing else.
                Styled to look identical to the h2 it replaces. */}
            {/* `title` on a truncating element, because the longest live company name is
                41 characters ("Quality Power Washing & Paver Restoration") at 15px semibold
                in ~330px of header, and the one string this panel exists to edit was
                unreadable with no way to reveal it. */}
            <SheetTitle
              className="text-[15px] font-semibold tracking-[-0.01em] truncate"
              title={displayCompany(account) ?? 'Unmapped account'}
            >
              {displayCompany(account) ?? <span className="text-muted-foreground italic">Unmapped account</span>}
            </SheetTitle>
            <SheetDescription className="mt-0.5 text-[13px] text-muted-foreground truncate" title={metaName ?? undefined}>
              {metaName ?? 'Meta has no name for this account'}
            </SheetDescription>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-row-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* THE BLOCK THAT BEATS A MODAL: read-only facts that say what this account is. */}
          {/**
            * ⚠️ FIVE ITEMS IN A TWO-COLUMN GRID LEAVES A HOLE, and the hole was next to
            * "Last seen" — measured lefts 1057 / 1239 / 1057 / 1239 / 1057. An orphaned cell
            * in an otherwise ruled block reads as a missing value rather than as the end of
            * a list. `Account ID` spans both columns instead: it is the longest string here,
            * it is the row's actual primary key, and promoting it leaves an exact 2×2 of
            * short numeric/date facts underneath. Five items, no hole, no filler.
            */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-surface-raised p-4">
            <Ref label="Account ID" value={account.account_id} mono className="col-span-2" />
            <Ref label="Spend, last 30 days" value={formatMoney(account.spend_30d)} mono />
            {/* `leads_30d` was fetched on every load and rendered nowhere. Spend without
                leads cannot answer the only question anyone asks of this pair. */}
            <Ref label="Leads, last 30 days" value={account.leads_30d == null ? '—' : account.leads_30d.toLocaleString('en-US')} mono />
            <Ref label="First seen" value={shortDate(account.first_seen)} />
            <Ref label="Last seen" value={shortDate(account.last_seen)} />
          </div>

          {state === 'unconfirmed' && (
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              This company name was copied from Meta automatically and has never been
              confirmed by anyone. Saving it as it stands is how you confirm it.
            </p>
          )}

          {/**
            * ⛔ THE `<datalist>` IS GONE. It was the single most important field on the
            * screen and it opened raw, unstylable browser chrome 40px above a custom cmdk
            * combobox — two dropdown languages inside one 420px panel, on the exact
            * complaint ("the dropdowns on here look horrendous") that ui/combobox.tsx was
            * written to answer. A datalist also offers no Create affordance, so nothing on
            * screen said that typing a new name was allowed.
            */}
          <Field
            label="Company name"
            htmlFor="company-name"
            hint="The client this ad account belongs to. This is the name shown everywhere in the app. Type to search the names already in use, or add a new one."
          >
            <Combobox
              id="company-name"
              aria-labelledby="company-name-label"
              value={company || null}
              onChange={v => setCompany(v ?? '')}
              options={companies}
              creatable
              clearable
              clearLabel="No company name"
              placeholder="Choose or add a company"
              searchPlaceholder="Search or add a company"
              emptyLabel="No matching company. Type a name to add it."
            />
          </Field>

          {/* ⚠️ THE HINT NO LONGER PROMISES AN EXCLUSION NOBODY IMPLEMENTS (see the footnote
              under AccountsTable), and it no longer says "Click": the cells are real buttons,
              so Enter and Space clear a selection exactly the way the mouse does, and naming
              only the mouse gesture told keyboard users the capability was not theirs. */}
          <Field label="Program" hint="Internal marks agency and recruiting accounts so they are grouped apart from clients. Choose the selected option again to clear it.">
            <Segmented
              aria-label="Program"
              value={program}
              onChange={setProgram}
              options={PROGRAMS}
              // `program` is nullable and five live rows are null. Without this the control
              // could reach every state except the one the data starts in.
              allowDeselect
            />
          </Field>

          <Field label="Media buyer" htmlFor="media-buyer">
            <Combobox
              id="media-buyer"
              aria-labelledby="media-buyer-label"
              value={buyer}
              onChange={setBuyer}
              options={buyers}
              creatable
              clearable
              clearLabel="Unassigned"
              placeholder="Unassigned"
              searchPlaceholder="Search or add a buyer"
              emptyLabel="No media buyers yet. Type to add one."
            />
          </Field>

          <Field label="Status">
            <Segmented
              aria-label="Status"
              value={status}
              // Not deselectable: `status` is NOT NULL in the table and the row has to be
              // one of the two. A null here would be a state the database cannot hold.
              onChange={v => setStatus(v ?? 'active')}
              options={STATUSES}
            />
          </Field>
        </div>

        <div className="shrink-0 border-t border-divider px-5 py-4 space-y-3">
          {/* A save failure lands HERE, inline, next to the thing that failed. The old
              component wrote it to the same state the table branched on, so one failed
              PATCH replaced all 52 rows and the in-progress draft with a Postgres string. */}
          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              Could not save: {error} Nothing was changed.
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => onOpenChange(false)}
              className="h-9 px-3 text-[13px] font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-row-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void commit()}
              disabled={saving || !canSave}
              /**
               * `hover:brightness-95` and not `hover:opacity-90`: opacity fades the LABEL
               * along with the fill, so the hover state made the button harder to read.
               *
               * 🔴 AND `disabled:opacity-50` WAS UNREADABLE, on the state this panel OPENS
               * IN. `bg-primary` #1a6eff at 50% over white is #8DB7FF; white text on that
               * measures 2.04:1, against a 4.5:1 floor. Every already-mapped row lands there
               * the moment it opens. A disabled control should read as a different control,
               * not as a faded one: muted fill, muted-foreground label, full opacity.
               */
              className="h-9 px-4 text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:brightness-95 transition-[filter,colors] disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-ring flex items-center gap-2"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? 'Saving' : !dirty && state === 'unconfirmed' ? 'Confirm name' : 'Save changes'}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
