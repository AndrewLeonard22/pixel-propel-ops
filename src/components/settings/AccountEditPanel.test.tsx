import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AccountEditPanel from './AccountEditPanel';
import type { AdAccount } from './AccountsTable';

/**
 * 🔴 CANCEL DID NOT DISCARD THE DRAFT, AND THE NEXT CLICK COULD COMMIT IT.
 *
 * The reset effect keyed on `[account]` by OBJECT IDENTITY. `openRow(r)` hands back the
 * same object out of a memoised array every time, and this component never unmounts — only
 * Radix's `SheetContent` does. So typing a name, pressing Cancel and reopening the SAME row
 * left the abandoned text in the box with "Save changes" armed, one stray click away from
 * writing an edit the user explicitly cancelled to the column this whole screen protects.
 *
 * ⚠️ A STATE FACT, WHICH IS WHY IT IS TESTED BY DRIVING THE COMPONENT rather than by
 * asserting on a class list: nothing in the markup distinguishes a live draft from a
 * discarded one.
 */

const ACCOUNT: AdAccount = {
  account_id: '596293242787360',
  meta_name: 'Backyard Paradiso',
  company_name: 'Backyard Paradiso Ltd',
  program: 'Done With You',
  media_buyer: 'Jez',
  status: 'active',
  first_seen: '2025-01-01',
  last_seen: '2026-08-11',
  spend_30d: 10742.74,
  leads_30d: 230,
};

function Harness({ onSave }: { onSave: (id: string, patch: Partial<AdAccount>) => Promise<string | null> }) {
  // The real call site: ONE stable account object, open/close driven by a parent flag, and
  // the panel itself never unmounting.
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>reopen</button>
      <AccountEditPanel
        account={ACCOUNT}
        open={open}
        onOpenChange={setOpen}
        companies={['Backyard Paradiso Ltd']}
        buyers={['Jez']}
        onSave={onSave}
      />
    </>
  );
}

const companyBox = () => screen.getByRole('combobox', { name: /company name/i });

describe('🔴 Cancel discards the draft', () => {
  it('reopening the same row after Cancel shows the SAVED value, not the abandoned one', async () => {
    const onSave = vi.fn(async () => null);
    render(<Harness onSave={onSave} />);

    // The panel opens on the saved value.
    expect(companyBox()).toHaveTextContent('Backyard Paradiso Ltd');

    // Type a replacement through the combobox's create affordance.
    fireEvent.click(companyBox());
    fireEvent.change(await screen.findByPlaceholderText('Search or add a company'), {
      target: { value: 'Totally Different Client' },
    });
    fireEvent.click(await screen.findByText(/Create/));
    expect(companyBox()).toHaveTextContent('Totally Different Client');

    // Cancel, then reopen the SAME row object.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByText('reopen'));

    expect(companyBox()).toHaveTextContent('Backyard Paradiso Ltd');
    expect(companyBox()).not.toHaveTextContent('Totally Different Client');
    // And nothing was ever written.
    expect(onSave).not.toHaveBeenCalled();
  });

  it('🔑 ANTI-VACUITY: the draft really is editable, so the arm above is not passing on a dead control', async () => {
    render(<Harness onSave={async () => null} />);
    fireEvent.click(companyBox());
    fireEvent.change(await screen.findByPlaceholderText('Search or add a company'), {
      target: { value: 'Edited In Place' },
    });
    fireEvent.click(await screen.findByText(/Create/));
    expect(companyBox()).toHaveTextContent('Edited In Place');
  });
});

describe('the disabled primary is readable, and it is the state the panel OPENS in', () => {
  it('⛔ NOT `disabled:opacity-50` on `bg-primary` — that measured 2.04:1', async () => {
    render(<Harness onSave={async () => null} />);
    // An already-mapped, already-confirmed row opens with nothing to save.
    const save = screen.getByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();
    // #1a6eff at 50% over white is #8DB7FF; white on that is 2.04:1 against a 4.5:1 floor.
    // A disabled control reads as a DIFFERENT control, not as a faded one.
    expect(save.className).toContain('disabled:bg-muted');
    expect(save.className).toContain('disabled:text-muted-foreground');
    expect(save.className).not.toMatch(/disabled:opacity-50/);
  });
});

/**
 * 🔴 EVERY COMBOBOX IN THIS APP WAS NAMELESS. axe-core `button-name`, impact CRITICAL.
 *
 * The trap is that they LOOK labelled: the trigger's text content is the selected value
 * ("Jez"), which names a `role="button"` for free. But `role="combobox"` is not in the
 * "name from content" set, so the accname algorithm never reaches step 2F and falls off the
 * end with an empty string. A control that renders its own state and still has no name is
 * the label-is-not-an-identity shape exactly: the visible string is a VALUE.
 *
 * "Media buyer" was the worst case, because this file's own docblock states the rule it
 * broke — `<Field label="Media buyer">` with no `htmlFor` over a control that HAS an id.
 */
describe('🔴 the panel\'s comboboxes have accessible names, and the label really points at them', () => {
  it('both comboboxes are findable BY NAME, which is the whole assertion', () => {
    render(<Harness onSave={async () => null} />);
    expect(screen.getByRole('combobox', { name: 'Company name' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Media buyer' })).toBeInTheDocument();
  });

  it('the name comes from the VISIBLE label, so the two can never drift apart', () => {
    render(<Harness onSave={async () => null} />);
    const buyer = screen.getByRole('combobox', { name: 'Media buyer' });
    const label = document.getElementById(buyer.getAttribute('aria-labelledby')!);
    expect(label?.tagName).toBe('LABEL');
    expect(label).toHaveTextContent('Media buyer');
    // A `<label for>` that points at nothing is the defect wearing a fix's clothes.
    expect(label?.getAttribute('for')).toBe(buyer.id);
  });

  it('🔑 ANTI-VACUITY: the name is not just the selected value leaking through', () => {
    render(<Harness onSave={async () => null} />);
    // The fixture's buyer is "Jez". If the accname were coming from content, this would find it.
    expect(screen.queryByRole('combobox', { name: 'Jez' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Media buyer' })).toHaveTextContent('Jez');
  });
});
