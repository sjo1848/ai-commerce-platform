import type { TaskState } from "./contracts.js";
import type { ServerControlEvent, TaskEvent, TaskStateReduction, TaskStateRejection } from "./events.js";
import { reduceTaskState as reduceCore } from "./task-state-reducer-core.js";
import { eventSchemaRejection, stateSchemaClosed } from "./task-state-schema-boundary.js";

function rejected(state: Readonly<TaskState>, rejection: TaskStateRejection): TaskStateReduction {
  return { state: state as TaskState, accepted: false, material: false, duplicate: false, invalidations: [], rejection };
}

function coreEvent(event: TaskEvent, current: Readonly<TaskState>): TaskEvent {
  if (event.kind !== "server_control" || event.payload.kind !== "tool_control_failure") return event;

  // `tool_control_failure` is an orchestration cause, not business truth. The
  // public Reducer boundary still owns its causal admission/idempotency/revision
  // semantics, while the reducer core receives an explicit no-op lifecycle
  // transition and therefore cannot accidentally persist policy/runtime detail.
  const normalized: ServerControlEvent = {
    ...event,
    payload: { kind: "lifecycle_changed", lifecycle: current.lifecycle },
  };
  return normalized;
}

export function reduceTaskState(current: Readonly<TaskState>, event: TaskEvent): TaskStateReduction {
  if (!stateSchemaClosed(current)) return rejected(current, "state_invariant_violation");
  const schemaRejection = eventSchemaRejection(event);
  return schemaRejection ? rejected(current, schemaRejection) : reduceCore(current, coreEvent(event, current));
}
