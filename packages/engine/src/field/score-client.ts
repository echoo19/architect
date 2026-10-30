/**
 * `env/score_client.py`, written into every field export: a small Python client for the outcome
 * scorer, since training frameworks are Python. Standard library only. It starts
 * `architect reward score` as a child process and exchanges one JSON line per attempt with it.
 */
export const SCORE_CLIENT_PY = `"""Scores attempts at this field's train tasks with Architect's outcome scorer.

The scorer is a local process: \`architect reward score --env <this folder>\`. It reads one JSON
request per line and writes one JSON score per line, with the job's own deterministic checker.
This client starts it and exchanges lines with it. Standard library only.

    from score_client import Scorer

    with Scorer() as scorer:
        score = scorer.score("copperfield-assign-01", final_text, changes=[
            {"path": "data/assignments.csv", "text": new_assignments_csv},
        ])
        if "error" not in score:
            reward = score["reward"]  # 1 or 0, with score["reason"]

A score with "error" is not a judgment of the attempt (the request couldn't be read, or the
scorer itself failed): leave that sample out rather than count it as 0.
"""

import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))


class ScorerError(RuntimeError):
    """The scorer process stopped or wrote something that isn't a score."""


class Scorer:
    def __init__(self, command=None, env_dir=HERE):
        """\`command\` is how to start the scorer; by default the \`architect\` command on PATH."""
        self.command = list(command) if command else ["architect", "reward", "score", "--env", env_dir]
        self.process = subprocess.Popen(
            self.command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )

    def score(self, task_id, final_text, changes=(), tool_calls=(), stop_reason="answer", request_id=None):
        """Scores one attempt: its final reply, its changed files' new texts and its tool calls."""
        request = {
            "task_id": task_id,
            "final_text": final_text,
            "changes": list(changes),
            "tool_calls": list(tool_calls),
            "stop_reason": stop_reason,
        }
        if request_id is not None:
            request["id"] = request_id
        self.process.stdin.write(json.dumps(request) + "\\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise ScorerError("The scorer stopped (exit code %s)." % self.process.wait())
        try:
            return json.loads(line)
        except ValueError:
            raise ScorerError("The scorer wrote a line that isn't JSON: %r" % line[:200])

    def close(self):
        if self.process.stdin and not self.process.stdin.closed:
            self.process.stdin.close()
        return self.process.wait()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
`;
