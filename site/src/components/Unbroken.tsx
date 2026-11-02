/** A quote whose hyphenated words ("high-quality") never break at the hyphen. */
export function Unbroken({ text }: { text: string }) {
  return text.split(/(\S*\w-\w\S*)/).map((piece, index) =>
    index % 2 === 1 ? (
      <span key={index} className="whitespace-nowrap">
        {piece}
      </span>
    ) : (
      piece
    ),
  );
}
