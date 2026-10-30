# Architect

Architect turns an organization's own material into a specialist that runs on its own computer. A large model studies the material and teaches a small one. The small model is then tested on organizations it never saw, one of them real. [See it on the website](https://echoo19.github.io/architect/).

The main example is Phil, a tutor for test-prep academies. A student misses a practice question and someone asks Phil what to do. Phil answers from that academy's own files: its topics, question bank, lessons, the student's history and its tutoring policy. Two academies with different policies get different correct actions from the same Phil.

## How it works

1. **Study.** Muse Spark, a large model, reads the organization's files and writes a short brief: the skills, the rules it found, and what is unclear. You confirm it.
2. **Teach.** Spark teaches Muse Glimmer, a small model that fits on a PC, on some of the organizations. When Glimmer gets something wrong, Spark finds the step where it went wrong and changes Glimmer's instructions and tools. A change stays only if Glimmer then does better on check tasks Spark never sees.
3. **Seal.** Other organizations are kept away from both models, so nothing is learned from them.
4. **Qualify.** A final test runs once, after everything is frozen. A program scores it for each skill at each organization, and never scores wording.

The result is a specialist that works on an organization's files, asks before it changes one, and talks to nothing but the model on your machine. The same steps work on a single job, like the returns desk below.

## Results

### Phil, tested across academies

Phil is Glimmer with the instructions and tools Spark built for it. Spark studied three generated academies and taught Glimmer on them. The sealed test had 120 tasks: 48 held out from those three academies, 48 from Harborview Prep, a fourth generated academy with numbers in its policy that no taught academy has, and 24 from a real academy, anonymized, whose records are not published. Neither model had seen the last two. On the real academy only three skills could be checked, because its records have no question text.

| Passed, out of tasks | Glimmer on a blank setup | Spark's one-shot setup | Phil |
| --- | --- | --- | --- |
| Taught academies (48) | 21 | 22 | 44 |
| Harborview Prep, unseen (48) | 24 | 22 | 43 |
| Real academy, unseen (24) | 9 | 11 | 12 |

- On Harborview Prep, Phil passed 43 of 48 and a blank setup 24. Task by task, Phil won 20 and lost 1, a difference of 39.6 points with a 95% interval of 22.9 to 53.7. A gain is shown on that one academy.
- On the real academy, Phil passed 12 of 24 and a blank setup 9. The difference is 12.5 points with an interval of -17.9 to 40.2. No gain is shown there.
- By skill on the real academy, assign went from 0 of 8 to 7 of 8, history fell from 5 to 3 and diagnose from 4 to 2. Eight tasks per skill is too few to call these differences.
- The misses came from tools built on the generated academies. The question lookup tool found a test by its section, and 11 of the real academy's 19 practice tests list the section as "Full". The history helper counted answers written another way as wrong, and the agent's date did not match the date in the requests. We found this by replaying Phil's tools against the real academy's files after the test was retired. The date cause fits the records and is not confirmed.
- The one-shot setup showed no gain over a blank setup in any group.
- Teaching took three rounds, about 15 minutes. Two changes were kept and one was reverted. The run cost about $0.58 of Spark and $4.26 of hosted Glimmer.

Limits: the numbers come from full-precision Glimmer hosted through OpenRouter, under one seed, and the build that runs on your computer was not measured. The real academy gave 24 tasks from 16 students, and its policy was drafted for this test and awaits the academy's confirmation. A script confirmed the study, not a person. The settings differ by arm: the blank setup ran at temperature 1 with 16 turns, and the other two at temperature 0 with 30 turns. The full report is [docs/comparisons/phil-1.md](docs/comparisons/phil-1.md).

<!-- A second field run's numbers go here, in the same form: the setups by group, the paired results, the misses and the limits. -->

### The returns desk, one job

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/comparisons/screens/returns-desk-2-train-light.png">
  <img alt="A real training run: Spark teaching Glimmer the returns desk, the check score climbing from 69% past the 95% target, and Spark's diagnosis of the round it kept" src="docs/comparisons/screens/returns-desk-2-train-dark.png">
</picture>

This run came before Phil's. It is the simpler case: one job and one business's files.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/comparisons/results-light.svg">
  <img alt="Final-test requests answered right, out of 60. Comparison 2: Glimmer on its own 44, Spark's one-shot setup 38, Glimmer after Spark's teaching 58. Comparison 1: on its own 43, one-shot setup 47, after teaching 45, Spark doing the job itself 60. The target is 57." src="docs/comparisons/results-dark.svg">
</picture>

- On a new returns desk, teaching took Glimmer from 44 to 58 of 60 on requests it had never seen. Request by request it fixed 15 and broke 1, so it's 23 points better, with a 95% interval of 11 to 36. The plan was [published before the run](docs/comparisons/returns-desk-2-plan.md).
- Its typical answer dropped from 17.7 seconds to 3.5.
- The teaching cost 42 cents of Spark.
- A run before it, with teaching held to two rounds, showed no clear gain.

Those numbers were measured on full-precision Glimmer, hosted through OpenRouter. The gain came from changes to Glimmer's instructions and tools; no weights were trained. The smaller 4-bit build that runs on your computer has not been measured on this test. The numbers come from 1,956 real attempts. Glimmer read 78 million tokens and wrote 2.7 million through OpenRouter ($7.92), and Spark used 4.7 million ($3.06). The full reports are in [docs/comparisons](docs/comparisons).

## Where it fits

<img align="right" width="64" alt="Y Combinator" src="docs/images/yc-logo.svg">

Y Combinator's [Requests for Startups for Winter 2027](https://www.ycombinator.com/rfs) asks for vertical models: specialized ones "matching or beating general-purpose models at orders of magnitude less inference compute". It names the hard part as high-quality rewards that are specific to the field and can be verified. This is our reading of that request, and Architect does not claim to meet it. We see it as a small step in that direction. The idea is direction, not result: if the same loop ran over many organizations of one field, it would produce verified curricula and checkable rewards, and field-specific models need both. Phil shows one field, three taught academies, one unseen generated academy and one real academy with 24 tasks, which is far short of that. What Architect does today is turn one organization's own records and policy into tasks with exact answers, and a large model teaches a small one until it passes them on its own, on the organization's own computer. For people building vertical models, it's a way to find out whether a small model can do the work, and to make it better at it.

## Related work

Improving an agent from its failures already has published work, such as GEPA ([arXiv 2507.19457](https://arxiv.org/abs/2507.19457)) and ACE ([arXiv 2510.04618](https://arxiv.org/abs/2510.04618)). Checking an agent's work by the state it leaves behind has precedent too, in tau-bench ([arXiv 2406.12045](https://arxiv.org/abs/2406.12045)). Architect puts these ideas into one product you can inspect. It has a sealed final test, a checker that is the same every time, and a result that runs offline.

## Get it

Download it for Windows or macOS from the [website](https://echoo19.github.io/architect/download/) or the [latest release](https://github.com/echoo19/architect/releases/latest). You'll need [Ollama](https://ollama.com). The first screens download Glimmer (17 GB, or 14 GB for a 12 GB graphics card) and connect Spark with an API key from Meta. The Mac app is signed and notarized by Apple. The Windows installer isn't signed yet, so the first time Windows warns you: choose More info, then Run anyway.

Then describe a job of your own, try the sample job, or open the returns desk agent from the results above. [The user guide](docs/Architect-Guide.pdf) walks through each step.

## More

- Spark and Glimmer are the defaults, not requirements. The teacher can be a model from OpenAI, Anthropic, Google or OpenRouter, or a local one in Ollama or LM Studio, and the training settings sit under Advanced, including what the teacher may change: instructions, what the agent reads, small tools, its weights, or questions for you. See [docs/MODELS.md](docs/MODELS.md).
- If your files include a policy with prices, discounts or rounding, Architect shows you the rule it made from it, with worked examples, and trains only after you confirm it. On a repair shop's pricing, one round of teaching took Glimmer from 22 of 30 check tasks to 40 of 40 on its final test (a single run, not a planned comparison).
- An agent exports as one file, or publishes to Hugging Face, private by default.
- The `architect` command does the same from a terminal: [docs/CLI.md](docs/CLI.md).
- How it fits together, and why: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DECISIONS.md](docs/DECISIONS.md).

## Built during the Meta Global AI Developer Hackathon

Built from an empty repository between Oct 27 and Nov 4, 2026, by Jake Kang with Claude Code, with GPT-6 Astra and GPT-6 Sol for second opinions and code reviews. The idea came first; every line of code was written during the event. [docs/HACKATHON.md](docs/HACKATHON.md) has the details.

MIT licence.
