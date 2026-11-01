/**
 * The Lab's technical terms, each with the one plain sentence that explains it behind an info
 * icon (docs/DESIGN.md, "The Lab's words"). The app and the film's mocks both read them from here,
 * so a term never means two things. `mentor` is the teacher's short name ("Spark").
 */
export type LabTerm =
  | 'harness'
  | 'baseHarness'
  | 'engineeredHarness'
  | 'loraAdapter'
  | 'heldOutChecks'
  | 'sealedFinalTest'
  | 'riskCertificate'
  | 'regressionSuite'
  | 'fineTuningPlan'
  | 'clusterLaunchBundle'
  | 'onPremise';

export function defineTerm(term: LabTerm, mentor = 'Spark'): string {
  switch (term) {
    case 'harness':
      return 'The instructions, tools and lessons the model works with.';
    case 'baseHarness':
      return `The harness before ${mentor} changes anything.`;
    case 'engineeredHarness':
      return `A harness ${mentor} rewrote change by change, keeping only what measured better.`;
    case 'loraAdapter':
      return 'Small trained weights added to the base model.';
    case 'heldOutChecks':
      return `Tasks ${mentor} never sees, used to keep or roll back each change.`;
    case 'sealedFinalTest':
      return 'Tasks locked away until the end and opened once, with no teacher.';
    case 'riskCertificate':
      return 'A bound on how often the specialist is wrong when it answers.';
    case 'regressionSuite':
      return 'Failures cut down to a few rows, which every later change must still pass.';
    case 'fineTuningPlan':
      return 'How much memory and how many GPUs fine-tuning this model takes.';
    case 'clusterLaunchBundle':
      return 'The files your own scheduler needs to fine-tune on a cluster.';
    case 'onPremise':
      return 'This computer, where finished specialists run with no network.';
  }
}
