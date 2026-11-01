/**
 * The Lab's technical terms, each with the one plain sentence that explains it behind an info
 * icon (docs/DESIGN.md, "The Lab's words"). The app and the film's mocks both read them from here,
 * so a term never means two things. `mentor` is the teacher's short name ("Spark"); without one, a
 * sentence names the teacher model in general.
 */
export type LabTerm =
  | 'harness'
  | 'baseHarness'
  | 'engineeredHarness'
  | 'loraAdapter'
  | 'qlora'
  | 'fullFineTune'
  | 'practiceTasks'
  | 'heldOutChecks'
  | 'sealedFinalTest'
  | 'calibrationTasks'
  | 'riskCertificate'
  | 'regressionSuite'
  | 'fineTuningPlan'
  | 'clusterLaunchBundle'
  | 'onPremise';

export function defineTerm(term: LabTerm, mentor = 'the teacher model'): string {
  switch (term) {
    case 'harness':
      return 'The instructions, tools and lessons the model works with.';
    case 'baseHarness':
      return `The harness before ${mentor} changes anything.`;
    case 'engineeredHarness':
      return `A harness ${mentor} drafts whole, then changes one by one under the keep rule.`;
    case 'loraAdapter':
      return 'Small trained weights added to the base model.';
    case 'qlora':
      return 'A LoRA adapter trained over a 4-bit copy of the base model, using less memory.';
    case 'fullFineTune':
      return 'Every weight of the model trained, which takes the most memory.';
    case 'practiceTasks':
      return `Tasks the specialist attempts while ${mentor} reads its failures.`;
    case 'heldOutChecks':
      return `Tasks ${mentor} never sees, used to keep or roll back each change.`;
    case 'sealedFinalTest':
      return 'Tasks locked away until the end and opened once, with no teacher.';
    case 'calibrationTasks':
      return 'Tasks kept from teaching, used to measure the risk certificate.';
    case 'riskCertificate':
      return 'A bound on how often the specialist is wrong when it answers.';
    case 'regressionSuite':
      return 'Failures cut down to a few rows, which later changes to the same helper must pass.';
    case 'fineTuningPlan':
      return 'How much memory and how many GPUs fine-tuning this model takes.';
    case 'clusterLaunchBundle':
      return 'The files your own scheduler needs to fine-tune on a cluster.';
    case 'onPremise':
      return 'This computer, where finished specialists run with no network.';
  }
}

/**
 * The words a screen both editions share uses for the same parts: the personal edition's plain
 * ones and the Lab's precise ones, so no screen mixes the two (docs/DESIGN.md).
 */
export interface Words {
  /** True for the Lab's words, for the few sentences that are built differently there. */
  lab: boolean;
  /** "check tasks" or "held-out checks", inside a sentence. */
  checks: string;
  /** "Check tasks" or "Held-out checks", as a label. */
  Checks: string;
  /** "Check task" or "Held-out check", one of them. */
  CheckTask: string;
  /** "final test" or "sealed final test", inside a sentence. */
  finalTest: string;
  /** "Final test" or "Sealed final test", as a label. */
  FinalTest: string;
  /** "setup" or "harness", inside a sentence. */
  setup: string;
  /** "Setup" or "Harness", as a label. */
  Setup: string;
  /** "trained weights" or "a LoRA adapter", inside a sentence. */
  weights: string;
  /** "Trained weights" or "LoRA adapter", as a label. */
  Weights: string;
  /** "Training weights" or "Fine-tuning a LoRA adapter", as a status. */
  TrainingWeights: string;
  /** "Retraining Glimmer" or "Fine-tuning a LoRA adapter", for the weights' cap and blocks. */
  retraining: (student: string) => string;
  /** "Counterexamples" or "Regression suite", as a heading. */
  Counterexamples: string;
}

export const WORDS: Record<'personal' | 'lab', Words> = {
  personal: {
    lab: false,
    checks: 'check tasks',
    Checks: 'Check tasks',
    CheckTask: 'Check task',
    finalTest: 'final test',
    FinalTest: 'Final test',
    setup: 'setup',
    Setup: 'Setup',
    weights: 'trained weights',
    Weights: 'Trained weights',
    TrainingWeights: 'Training weights',
    retraining: (student) => `Retraining ${student}`,
    Counterexamples: 'Counterexamples',
  },
  lab: {
    lab: true,
    checks: 'held-out checks',
    Checks: 'Held-out checks',
    CheckTask: 'Held-out check',
    finalTest: 'sealed final test',
    FinalTest: 'Sealed final test',
    setup: 'harness',
    Setup: 'Harness',
    weights: 'a LoRA adapter',
    Weights: 'LoRA adapter',
    TrainingWeights: 'Fine-tuning a LoRA adapter',
    retraining: () => 'Fine-tuning a LoRA adapter',
    Counterexamples: 'Regression suite',
  },
};
