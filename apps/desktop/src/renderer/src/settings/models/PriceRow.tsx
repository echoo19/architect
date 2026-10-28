import { useState, type FormEvent } from 'react';
import type { TokenPricing } from '@architect/shared';
import { Button, Input, SettingsRow } from '@architect/ui';

export interface PriceRowProps {
  /** The model whose price is asked for, as people name it. */
  model: string;
  onSave: (pricing: TokenPricing) => void;
}

function dollars(text: string): number | null {
  const value = Number(text.trim().replace(/^\$/, ''));
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Asks what a model without a known price costs, in dollars per million tokens in and out. The
 * spending cap needs it: a mentor with no price can't be trained with (decision 029).
 */
export function PriceRow({ model, onSave }: PriceRowProps) {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const inputPerM = dollars(input);
  const outputPerM = dollars(output);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (inputPerM === null || outputPerM === null) return;
    // Cached input is billed at the full input rate here, which can only overstate the cost.
    onSave({ inputPerM, cachedInputPerM: inputPerM, outputPerM });
  };

  return (
    <SettingsRow label="Price" meta={`What ${model} costs per million tokens, in and out`}>
      <form className="flex items-center gap-2" onSubmit={save}>
        <Input
          aria-label="Dollars per million input tokens"
          inputMode="decimal"
          placeholder="$ in"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="w-20"
        />
        <Input
          aria-label="Dollars per million output tokens"
          inputMode="decimal"
          placeholder="$ out"
          value={output}
          onChange={(event) => setOutput(event.target.value)}
          className="w-20"
        />
        <Button type="submit" size="xs" disabled={inputPerM === null || outputPerM === null}>
          Save
        </Button>
      </form>
    </SettingsRow>
  );
}
