import type { TaskState } from "./contracts.js";
import type { TaskEvent, TaskStateReduction, TaskStateRejection } from "./events.js";
import { reduceTaskState as reduceCore } from "./task-state-reducer-core.js";
import { eventSchemaRejection, stateSchemaClosed } from "./task-state-schema-boundary.js";

function rejected(state: Readonly<TaskState>, rejection: TaskStateRejection): TaskStateReduction {
  return { state: state as TaskState, accepted: false, material: false, duplicate: false, invalidations: [], rejection };
}

export function reduceTaskState(current: Readonly<TaskState>, event: TaskEvent): TaskStateReduction {
  if (!stateSchemaClosed(current)) return rejected(current, "state_invariant_violation");
  const schemaRejection = eventSchemaRejection(event);
  return schemaRejection ? rejected(current, schemaRejection) : reduceCore(current, event);
}
