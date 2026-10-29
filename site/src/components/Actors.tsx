import { Fragment } from 'react';

const NAMES = /(Spark|Glimmer)/;

/** Text in which the two models' names are set in their own colors: Spark amber, Glimmer blue. */
export function Actors({ text }: { text: string }) {
  return (
    <>
      {text.split(NAMES).map((part, index) => {
        if (part === 'Spark') {
          return (
            <span key={index} className="text-mentor">
              Spark
            </span>
          );
        }
        if (part === 'Glimmer') {
          return (
            <span key={index} className="text-student">
              Glimmer
            </span>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}
