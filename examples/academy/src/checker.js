// End-state and answer checks for the academy job (Phil, the tutor).
//
// The runner loads this file in a sandbox and calls the validator a task names, passing the
// task's params and a context:
//   ctx.readTable(name)          a table of the task's academy after the attempt: one object per
//                                row, each value a string, empty cells null
//   ctx.readOriginalTable(name)  the same table before the attempt
//   ctx.answer                   the JSON after the reply's last ANSWER: line, or null
// A validator returns { pass, reason, details }. The reason is one sentence for a person, and it
// starts with the field or table that is wrong, so a locked-test result can name it and nothing
// else. Nothing here reads a clock or draws a random number, so the same attempt always gets the
// same verdict.
//
// Where the policy allows more than one right action, any of them passes: any practice
// questions that meet the policy's rules, any video in the topic's folder, any of the errors
// that produce the same wrong choice, any of the hints the policy allows.

var validators = {};

// The tables an attempt may write to.
const WRITABLE_TABLES = ['assignments.csv', 'staff_notes.csv'];

// diagnosis: no table changed, and the ANSWER names the topic, the right choice and an error
// that produces the chosen wrong answer. A task from an academy's records alone has no
// params.errors, and then only the topic and the right choice are checked.
validators.diagnosis = (params, ctx) => {
  const other = otherTableChanged(ctx, null);
  if (other) return fail(`${other} changed, but this task only asks a question.`);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  return (
    topicProblem(answer, params) ||
    correctProblem(answer, params) ||
    (params.errors === undefined ? null : errorProblem(answer, params)) ||
    pass(`Diagnosed: ${params.topic}, right choice ${params.correct}.`)
  );
};

// hint_chosen: no table changed, and the ANSWER names the topic and a first hint the policy
// allows for this wrong answer.
validators.hint_chosen = (params, ctx) => {
  const other = otherTableChanged(ctx, null);
  if (other) return fail(`${other} changed, but this task only asks for a hint.`);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  return (
    topicProblem(answer, params) ||
    hintProblem(answer, params) ||
    pass(`The first hint is ${text(answer.hint_id)}.`)
  );
};

// practice_assigned: assignments.csv gained exactly the rows the policy asks for and nothing
// else changed; the ANSWER says how many.
validators.practice_assigned = (params, ctx) => {
  const other = otherTableChanged(ctx, 'assignments.csv');
  if (other) return fail(`${other} changed, but this task only assigns practice.`);
  const problem = practiceProblem(params, ctx);
  if (problem) return fail(problem);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  return assignedProblem(answer, params) || pass(practiceDone(params));
};

// tutoring_turn: the whole turn after a wrong answer. The ANSWER diagnoses it, picks the first
// hint and a video of the topic, and says how many questions were assigned and whether a staff
// note was left; assignments.csv gained the practice; staff_notes.csv gained one note for the
// tutor exactly when the policy calls for escalation.
validators.tutoring_turn = (params, ctx) => {
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  const answerProblem =
    topicProblem(answer, params) ||
    correctProblem(answer, params) ||
    errorProblem(answer, params) ||
    hintProblem(answer, params) ||
    videoProblem(answer, params, ctx) ||
    assignedProblem(answer, params);
  if (answerProblem) return answerProblem;
  if (typeof answer.staff_note !== 'boolean') {
    return fail(`staff_note in the ANSWER line is ${show(answer.staff_note)}, not true or false.`);
  }
  if (answer.staff_note !== params.escalate) {
    return fail(
      `staff_note in the ANSWER line is ${answer.staff_note} but should be ${params.escalate}: ` +
        `the student's history on the topic ${params.escalate ? 'calls' : 'does not call'} for escalation.`,
    );
  }
  const practice = practiceProblem(params, ctx);
  if (practice) return fail(practice);
  const note = noteProblem(params, ctx);
  if (note) return fail(note);
  return pass(`${practiceDone(params)}${params.escalate ? ' A note went to the tutor.' : ''}`);
};

function topicProblem(answer, params) {
  if (!hasOwn(answer, 'topic')) return fail('topic is missing from the ANSWER line.');
  if (!sameText(answer.topic, params.topic)) {
    return fail(`topic is ${show(answer.topic)} but should be "${params.topic}".`);
  }
  return null;
}

function correctProblem(answer, params) {
  if (!hasOwn(answer, 'correct')) return fail('correct is missing from the ANSWER line.');
  if (!sameText(answer.correct, params.correct)) {
    return fail(`correct is ${show(answer.correct)} but should be ${params.correct}.`);
  }
  return null;
}

function errorProblem(answer, params) {
  if (!hasOwn(answer, 'error')) return fail('error is missing from the ANSWER line.');
  if (!params.errors.some((id) => sameText(answer.error, id))) {
    return fail(`error is ${show(answer.error)} but should be ${oneOf(params.errors)}.`);
  }
  return null;
}

function hintProblem(answer, params) {
  if (!hasOwn(answer, 'hint_id')) return fail('hint_id is missing from the ANSWER line.');
  if (!params.hint_ids.some((id) => sameText(answer.hint_id, id))) {
    return fail(`hint_id is ${show(answer.hint_id)} but should be ${oneOf(params.hint_ids)}.`);
  }
  return null;
}

function videoProblem(answer, params, ctx) {
  if (!hasOwn(answer, 'video_id')) return fail('video_id is missing from the ANSWER line.');
  const video = ctx
    .readOriginalTable('videos.csv')
    .find((row) => sameText(answer.video_id, text(row.video_id)));
  if (!video) return fail(`video_id ${show(answer.video_id)} is not in videos.csv.`);
  if (text(video.folder) !== params.folder) {
    return fail(
      `video_id ${show(answer.video_id)} is in the folder "${text(video.folder)}", not the topic's folder "${params.folder}".`,
    );
  }
  return null;
}

function assignedProblem(answer, params) {
  if (!hasOwn(answer, 'assigned')) return fail('assigned is missing from the ANSWER line.');
  if (numberOf(answer.assigned) !== params.expected_count) {
    return fail(
      `assigned in the ANSWER line is ${show(answer.assigned)} but should be ${params.expected_count}.`,
    );
  }
  return null;
}

function practiceDone(params) {
  if (params.expected_count === 0) return 'No question qualified, and none was assigned.';
  const short =
    params.expected_count < params.count
      ? `, all that qualify of the ${params.count} asked for`
      : '';
  return `Assigned ${params.expected_count} practice questions${short}.`;
}

// Why the assignments written are not the practice the policy asks for, or null.
function practiceProblem(params, ctx) {
  const change = compareRows(
    ctx.readOriginalTable('assignments.csv'),
    ctx.readTable('assignments.csv'),
  );
  if (change.removed.length > 0) {
    return `assignments.csv: an existing row was changed or deleted (${text(change.removed[0].assignment_id)}).`;
  }
  if (change.added.length !== params.expected_count) {
    const qualify =
      params.expected_count < params.count
        ? ` (only ${params.expected_count} questions qualify, so all of them)`
        : '';
    return `assignments.csv gained ${change.added.length} rows but should gain ${params.expected_count}${qualify}.`;
  }
  const questions = ctx.readOriginalTable('questions.csv');
  const attempted = ctx
    .readOriginalTable('attempts.csv')
    .filter((row) => text(row.student_id) === params.student_id)
    .map((row) => text(row.question_id));
  const assigned = ctx
    .readOriginalTable('assignments.csv')
    .filter((row) => text(row.student_id) === params.student_id)
    .map((row) => text(row.question_id));
  const ids = change.added.map((row) => text(row.assignment_id));
  const missingId = params.assignment_ids.find((id) => !ids.includes(id));
  if (missingId !== undefined) {
    return `assignment_id: expected the new rows to be ${params.assignment_ids.join(', ')}, numbered on from the file, but ${missingId} is missing.`;
  }
  const seen = [];
  for (const row of change.added) {
    const id = text(row.assignment_id);
    const field = fieldProblem(row, {
      student_id: params.student_id,
      assigned_on: params.assigned_on,
      assigned_by: params.assigned_by,
    });
    if (field) return `${field} (row ${id}).`;
    const questionId = text(row.question_id);
    if (seen.includes(questionId)) return `question_id ${questionId} is assigned twice.`;
    seen.push(questionId);
    const question = questions.find((q) => text(q.question_id) === questionId);
    if (!question)
      return `question_id ${show(row.question_id)} is not in questions.csv (row ${id}).`;
    if (text(question.topic) !== params.topic) {
      return `question_id ${questionId} is on "${text(question.topic)}", not "${params.topic}".`;
    }
    if (attempted.includes(questionId)) {
      return `question_id ${questionId} was already attempted by the student.`;
    }
    if (assigned.includes(questionId)) {
      return `question_id ${questionId} was already assigned to the student.`;
    }
    const difficulty = numberOf(text(question.difficulty_pct));
    if (difficulty === null || difficulty < params.band_low || difficulty > params.band_high) {
      return `question_id ${questionId} has difficulty_pct ${text(question.difficulty_pct)}, outside ${params.band_low} to ${params.band_high}.`;
    }
  }
  return null;
}

// Why the staff notes are not what the policy asks for, or null.
function noteProblem(params, ctx) {
  const change = compareRows(
    ctx.readOriginalTable('staff_notes.csv'),
    ctx.readTable('staff_notes.csv'),
  );
  if (change.removed.length > 0) {
    return `staff_notes.csv: an existing row was changed or deleted (${text(change.removed[0].note_id)}).`;
  }
  if (!params.escalate) {
    return change.added.length > 0
      ? 'staff_notes.csv gained a note, but the history does not call for escalation.'
      : null;
  }
  if (change.added.length !== 1) {
    return `staff_notes.csv gained ${change.added.length} rows but should gain one note for the tutor.`;
  }
  const row = change.added[0];
  const field = fieldProblem(row, {
    note_id: params.note_id,
    student_id: params.student_id,
    staff_id: params.assigned_by,
    written_on: params.assigned_on,
    topic: params.topic,
  });
  if (field) return `${field} (staff_notes.csv).`;
  if (text(row.note) === '') return 'note is empty (staff_notes.csv).';
  return null;
}

function fieldProblem(row, expected) {
  for (const field of Object.keys(expected)) {
    if (text(row[field]) !== expected[field]) {
      return `${field} is ${show(row[field])} but should be ${expected[field]}`;
    }
  }
  return null;
}

// Rows added to and removed from a table. The rows that were there must stay, unchanged and in
// their order, as the start of the table; whatever follows that start in the new table is added,
// and whatever of the old table does not is removed. A changed or moved row counts as one of each.
function compareRows(before, after) {
  const columns = Object.keys(before[0] || after[0] || {});
  const key = (row) => JSON.stringify(columns.map((column) => row[column] ?? null));
  let kept = 0;
  while (kept < before.length && kept < after.length && key(before[kept]) === key(after[kept])) {
    kept += 1;
  }
  return { added: after.slice(kept), removed: before.slice(kept) };
}

// The first writable table other than `allowed` whose rows the attempt changed, or null. An
// academy's export may have no staff_notes.csv, and a table that isn't there hasn't changed.
function otherTableChanged(ctx, allowed) {
  for (const table of WRITABLE_TABLES) {
    if (table === allowed) continue;
    const before = rowsIfPresent(() => ctx.readOriginalTable(table));
    if (before === null) continue;
    const change = compareRows(before, ctx.readTable(table));
    if (change.added.length > 0 || change.removed.length > 0) return table;
  }
  return null;
}

function rowsIfPresent(read) {
  try {
    return read();
  } catch {
    return null;
  }
}

// The same text, ignoring case, spaces at the ends and runs of spaces.
function sameText(value, expected) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const normal = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
  return normal(value) === normal(expected);
}

// A number, or text that is plainly one, as a number; anything else is null.
function numberOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^\s*-?\d+(\.\d+)?\s*$/.test(value)) return null;
  return Number(value);
}

function oneOf(ids) {
  return ids.length === 1 ? ids[0] : `one of ${ids.join(', ')}`;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function text(cell) {
  return cell === null || cell === undefined ? '' : String(cell).trim();
}

function show(value) {
  if (value === null || value === undefined || value === '') return 'empty';
  return typeof value === 'string' ? `"${value.trim()}"` : JSON.stringify(value);
}

function pass(reason, details) {
  return { pass: true, reason, details: details || {} };
}

function fail(reason, details) {
  return { pass: false, reason, details: details || {} };
}
