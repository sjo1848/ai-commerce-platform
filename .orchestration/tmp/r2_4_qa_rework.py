from pathlib import Path


def replace(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"target not found: {label}")
    p.write_text(text.replace(old, new, 1))


state_path = "src/core/conversation-state.ts"

replace(
    state_path,
    """  selectedRoomIds: string[];
  requestedRoomCount?: number;
  roomOccupancy: RoomOccupancy[];
  /** Server-managed revision preventing stale/concurrent room-selection rollback. */""",
    """  selectedRoomIds: string[];
  requestedRoomCount?: number;
  roomOccupancy: RoomOccupancy[];
  /** Server-owned markers: invalid/ambiguous references require clarification, never silent acknowledgement. */
  roomSelectionNeedsClarification?: boolean;
  roomOccupancyNeedsClarification?: boolean;
  /** Server-managed revision preventing stale/concurrent room-selection rollback. */""",
    "state clarification flags",
)

replace(
    state_path,
    """  selectedRoomNumbers?: string[] | null;
  requestedRoomCount?: number | null;
  roomOccupancy?: RoomOccupancyPatch[] | null;""",
    """  selectedRoomNumbers?: string[] | null;
  selectedRoomRelation?: \"both\" | \"other\" | null;
  requestedRoomCount?: number | null;
  roomOccupancy?: RoomOccupancyPatch[] | null;""",
    "relation patch type",
)

replace(
    state_path,
    """  if (validRoomCount(value.requestedRoomCount)) state.requestedRoomCount = Number(value.requestedRoomCount);

  if (Array.isArray(value.roomOccupancy)) {""",
    """  if (validRoomCount(value.requestedRoomCount)) state.requestedRoomCount = Number(value.requestedRoomCount);
  if (value.roomSelectionNeedsClarification === true) state.roomSelectionNeedsClarification = true;
  if (value.roomOccupancyNeedsClarification === true) state.roomOccupancyNeedsClarification = true;

  if (Array.isArray(value.roomOccupancy)) {""",
    "parse clarification flags",
)

replace(
    state_path,
    """function hasRoomSelectionState(state: ConversationState): boolean {
  return state.selectedRoomIds.length > 0 || state.requestedRoomCount !== undefined || state.roomOccupancy.length > 0;
}

function sameRoomSelectionState(left: ConversationState, right: ConversationState): boolean {
  return sameStringArray(left.selectedRoomIds, right.selectedRoomIds)
    && left.requestedRoomCount === right.requestedRoomCount
    && sameRoomOccupancy(left.roomOccupancy, right.roomOccupancy);
}""",
    """function hasRoomSelectionState(state: ConversationState): boolean {
  return state.selectedRoomIds.length > 0
    || state.requestedRoomCount !== undefined
    || state.roomOccupancy.length > 0
    || state.roomSelectionNeedsClarification === true
    || state.roomOccupancyNeedsClarification === true;
}

function sameRoomSelectionState(left: ConversationState, right: ConversationState): boolean {
  return sameStringArray(left.selectedRoomIds, right.selectedRoomIds)
    && left.requestedRoomCount === right.requestedRoomCount
    && sameRoomOccupancy(left.roomOccupancy, right.roomOccupancy)
    && left.roomSelectionNeedsClarification === right.roomSelectionNeedsClarification
    && left.roomOccupancyNeedsClarification === right.roomOccupancyNeedsClarification;
}""",
    "room state comparison flags",
)

replace(
    state_path,
    """  if (roomSource.requestedRoomCount !== undefined) next.requestedRoomCount = roomSource.requestedRoomCount;
  next.selectedRoomIds = roomSource.selectedRoomIds.filter((roomId) => next.availabilityRoomIds.includes(roomId));
  next.roomOccupancy = roomSource.roomOccupancy
    .filter((entry) => next.selectedRoomIds.includes(entry.roomId))
    .map((entry) => structuredClone(entry));
  syncSingleSelectionAlias(next);""",
    """  if (roomSource.requestedRoomCount !== undefined) next.requestedRoomCount = roomSource.requestedRoomCount;
  if (roomSource.roomSelectionNeedsClarification === true) next.roomSelectionNeedsClarification = true;
  else delete next.roomSelectionNeedsClarification;
  if (roomSource.roomOccupancyNeedsClarification === true) next.roomOccupancyNeedsClarification = true;
  else delete next.roomOccupancyNeedsClarification;
  next.selectedRoomIds = roomSource.selectedRoomIds.filter((roomId) => next.availabilityRoomIds.includes(roomId));
  next.roomOccupancy = roomSource.roomOccupancy
    .filter((entry) => next.selectedRoomIds.includes(entry.roomId))
    .map((entry) => structuredClone(entry));
  syncSingleSelectionAlias(next);""",
    "merge clarification flags",
)

replace(
    state_path,
    """    requestedRoomCount: state.requestedRoomCount ?? null,
    roomOccupancy: state.roomOccupancy,
  });""",
    """    requestedRoomCount: state.requestedRoomCount ?? null,
    roomOccupancy: state.roomOccupancy,
    roomSelectionNeedsClarification: state.roomSelectionNeedsClarification === true,
    roomOccupancyNeedsClarification: state.roomOccupancyNeedsClarification === true,
  });""",
    "fingerprint clarification flags",
)

replace(
    state_path,
    """  next.selectedRoomIds = [];
  next.roomOccupancy = [];
  delete next.selectedRoomId;
  bumpRoomSelectionRevisionIfChanged(next, before);""",
    """  next.selectedRoomIds = [];
  next.roomOccupancy = [];
  delete next.selectedRoomId;
  delete next.roomSelectionNeedsClarification;
  delete next.roomOccupancyNeedsClarification;
  bumpRoomSelectionRevisionIfChanged(next, before);""",
    "clear stale flags",
)

replace(
    state_path,
    """export function multiRoomConversationIssue(current: ConversationState): MultiRoomConversationIssue | undefined {
  const state = normalizeConversationState(current);
  if (state.requestedRoomCount !== undefined && state.selectedRoomIds.length !== state.requestedRoomCount) return \"which_rooms\";
  if (state.roomOccupancy.length > 0) {""",
    """export function multiRoomConversationIssue(current: ConversationState): MultiRoomConversationIssue | undefined {
  const state = normalizeConversationState(current);
  if (state.roomSelectionNeedsClarification === true) return \"which_rooms\";
  if (state.requestedRoomCount !== undefined && state.selectedRoomIds.length !== state.requestedRoomCount) return \"which_rooms\";
  if (state.roomOccupancyNeedsClarification === true) return \"occupancy_distribution\";
  if (state.roomOccupancy.length > 0) {""",
    "issue flags",
)

replace(
    state_path,
    """  const multiSelectionTouched = patch?.selectedRoomIds !== undefined
    || patch?.selectedRoomIndexes !== undefined
    || patch?.selectedRoomNumbers !== undefined;""",
    """  const multiSelectionTouched = patch?.selectedRoomIds !== undefined
    || patch?.selectedRoomIndexes !== undefined
    || patch?.selectedRoomNumbers !== undefined
    || patch?.selectedRoomRelation !== undefined;""",
    "relation touched",
)

replace(
    state_path,
    """      || patch?.selectedRoomNumbers === null
      || patch?.selectedRoomId === null""",
    """      || patch?.selectedRoomNumbers === null
      || patch?.selectedRoomRelation === null
      || patch?.selectedRoomId === null""",
    "relation explicit clear",
)

replace(
    state_path,
    """      if (valid && Array.isArray(patch?.selectedRoomNumbers)) {
        for (const number of patch.selectedRoomNumbers) {
          const roomId = roomIdForNumber(next, number);
          if (!roomId) { valid = false; break; }
          ids.push(roomId);
        }
      }
      resolved = valid ? uniqueStrings(ids).slice(0, 10) : [];""",
    """      if (valid && Array.isArray(patch?.selectedRoomNumbers)) {
        for (const number of patch.selectedRoomNumbers) {
          const roomId = roomIdForNumber(next, number);
          if (!roomId) { valid = false; break; }
          ids.push(roomId);
        }
      }
      if (valid && patch?.selectedRoomRelation === \"both\") {
        if (next.availabilityRoomIds.length === 2) ids.push(...next.availabilityRoomIds);
        else valid = false;
      }
      if (valid && patch?.selectedRoomRelation === \"other\") {
        if (next.availabilityRoomIds.length === 2 && next.selectedRoomIds.length === 1) {
          const other = next.availabilityRoomIds.find((roomId) => roomId !== next.selectedRoomIds[0]);
          if (other) ids.push(other);
          else valid = false;
        } else valid = false;
      }
      resolved = valid ? uniqueStrings(ids).slice(0, 10) : undefined;
      if (!valid) next.roomSelectionNeedsClarification = true;
      else delete next.roomSelectionNeedsClarification;""",
    "relation and invalid selection resolution",
)

replace(
    state_path,
    """      resolved = roomId && next.availabilityRoomIds.includes(roomId) ? [roomId] : [];
    }
    next.selectedRoomIds = resolved ?? next.selectedRoomIds;""",
    """      if (roomId && next.availabilityRoomIds.includes(roomId)) {
        resolved = [roomId];
        delete next.roomSelectionNeedsClarification;
      } else {
        next.roomSelectionNeedsClarification = true;
      }
    }
    if (explicitClear) delete next.roomSelectionNeedsClarification;
    next.selectedRoomIds = resolved ?? next.selectedRoomIds;""",
    "legacy invalid selection preservation",
)

replace(
    state_path,
    """  if (patch?.roomOccupancy === null) next.roomOccupancy = [];
  else if (Array.isArray(patch?.roomOccupancy)) {
    next.roomOccupancy = resolveRoomOccupancyPatch(next, patch.roomOccupancy) ?? [];
  }""",
    """  if (patch?.roomOccupancy === null) {
    next.roomOccupancy = [];
    delete next.roomOccupancyNeedsClarification;
  } else if (Array.isArray(patch?.roomOccupancy)) {
    const resolvedOccupancy = resolveRoomOccupancyPatch(next, patch.roomOccupancy);
    if (resolvedOccupancy) {
      next.roomOccupancy = resolvedOccupancy;
      delete next.roomOccupancyNeedsClarification;
    } else {
      next.roomOccupancyNeedsClarification = true;
    }
  }""",
    "invalid occupancy clarification",
)

replace(
    state_path,
    """  if (patch.selectedRoomNumbers !== undefined) safe.selectedRoomNumbers = patch.selectedRoomNumbers;
  if (patch.requestedRoomCount !== undefined) safe.requestedRoomCount = patch.requestedRoomCount;""",
    """  if (patch.selectedRoomNumbers !== undefined) safe.selectedRoomNumbers = patch.selectedRoomNumbers;
  if (patch.selectedRoomRelation !== undefined) safe.selectedRoomRelation = patch.selectedRoomRelation;
  if (patch.requestedRoomCount !== undefined) safe.requestedRoomCount = patch.requestedRoomCount;""",
    "strip relation",
)

llm_path = "src/core/llm-model.ts"
replace(
    llm_path,
    """    selectedRoomNumbers: { type: [\"array\", \"null\"], items: { type: \"string\", minLength: 1, maxLength: 20 }, maxItems: 10 },
    requestedRoomCount: { type: [\"integer\", \"null\"], minimum: 1, maximum: 10 },""",
    """    selectedRoomNumbers: { type: [\"array\", \"null\"], items: { type: \"string\", minLength: 1, maxLength: 20 }, maxItems: 10 },
    selectedRoomRelation: { type: [\"string\", \"null\"], enum: [\"both\", \"other\", null] },
    requestedRoomCount: { type: [\"integer\", \"null\"], minimum: 1, maximum: 10 },""",
    "llm relation schema",
)

replace(
    llm_path,
    '    "selectedRoomIds", "selectedRoomIndexes", "selectedRoomNumbers", "requestedRoomCount", "roomOccupancy",',
    '    "selectedRoomIds", "selectedRoomIndexes", "selectedRoomNumbers", "selectedRoomRelation", "requestedRoomCount", "roomOccupancy",',
    "llm relation allowlist",
)

replace(
    llm_path,
    """  if (value.requestedRoomCount !== undefined) {""",
    """  if (value.selectedRoomRelation !== undefined) {
    if (value.selectedRoomRelation === null || value.selectedRoomRelation === \"both\" || value.selectedRoomRelation === \"other\") {
      patch.selectedRoomRelation = value.selectedRoomRelation;
    } else return undefined;
  }
  if (value.requestedRoomCount !== undefined) {""",
    "parse relation",
)

replace(
    llm_path,
    """      \"For natural room numbers such as 'la 101 y la 102', use selectedRoomNumbers=['101','102']. They must come from CURRENT_CONVERSATION_STATE.availabilityRooms. Never derive a roomId from the number yourself.\",""",
    """      \"For natural room numbers such as 'la 101 y la 102', use selectedRoomNumbers=['101','102']. They must come from CURRENT_CONVERSATION_STATE.availabilityRooms. Never derive a roomId from the number yourself.\",
      \"Natural relational references are explicit too: if exactly TWO current candidates exist, 'las dos' => selectedRoomRelation='both'. If exactly one room is selected and exactly one other candidate exists, 'la otra' => selectedRoomRelation='other'. Otherwise these references are ambiguous and you must ask which room(s), never choose arbitrarily.\",""",
    "prompt relational refs",
)

replace(
    llm_path,
    """      \"Example after availabilityRooms=[{id:roomA,roomNumber:'101'},{id:roomB,roomNumber:'102'},{id:roomC,roomNumber:'103'}]: 'Quiero la 101 y la 102' => kind=message, clarificationReason=acknowledgement, statePatch={selectedRoomNumbers:['101','102']}, missing=[].\",""",
    """      \"Example with exactly two availability candidates 101 and 102: 'Me quedo con las dos' => kind=message, clarificationReason=acknowledgement, statePatch={selectedRoomRelation:'both'}, missing=[].\",
      \"Example with exactly two candidates and 101 currently selected: 'Mejor la otra' => kind=message, clarificationReason=acknowledgement, statePatch={selectedRoomRelation:'other'}, missing=[]. With three or more candidates, ask which one instead.\",
      \"Example after availabilityRooms=[{id:roomA,roomNumber:'101'},{id:roomB,roomNumber:'102'},{id:roomC,roomNumber:'103'}]: 'Quiero la 101 y la 102' => kind=message, clarificationReason=acknowledgement, statePatch={selectedRoomNumbers:['101','102']}, missing=[].\",""",
    "prompt relation examples",
)


test_path = Path("test/multi-room-conversation-r2.4.test.mjs")
tests = test_path.read_text()
tests += r'''

test("natural relation las dos resolves only when exactly two HMS candidates exist", () => {
  const twoCandidates = updateConversationStateFromTool(
    { ...emptyConversationState(), stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 4 }, semanticMemory: { revision: 0, stay: {}, preferences: [], scope } },
    "hms.checkAvailability",
    { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 4 },
    { rooms: [{ id: room101, roomNumber: "101" }, { id: room102, roomNumber: "102" }] },
  );
  const selected = applyConversationStatePatch(twoCandidates, { selectedRoomRelation: "both" });
  assert.deepEqual(canonicalSelectedRoomIds(selected), [room101, room102]);
  assert.equal(multiRoomConversationIssue(selected), undefined);

  const ambiguous = applyConversationStatePatch(groundedAvailability(4), { selectedRoomRelation: "both" });
  assert.deepEqual(canonicalSelectedRoomIds(ambiguous), []);
  assert.equal(multiRoomConversationIssue(ambiguous), "which_rooms");
});

test("natural relation la otra replaces one selection only when the other candidate is unambiguous", () => {
  const twoCandidates = updateConversationStateFromTool(
    { ...emptyConversationState(), stay: { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 }, semanticMemory: { revision: 0, stay: {}, preferences: [], scope } },
    "hms.checkAvailability",
    { checkIn: "2027-01-15", checkOut: "2027-01-17", guests: 2 },
    { rooms: [{ id: room101, roomNumber: "101" }, { id: room102, roomNumber: "102" }] },
  );
  const first = applyConversationStatePatch(twoCandidates, { selectedRoomNumbers: ["101"] });
  const other = applyConversationStatePatch(first, { selectedRoomRelation: "other" });
  assert.deepEqual(canonicalSelectedRoomIds(other), [room102]);
  assert.equal(other.selectedRoomId, room102);

  const threeFirst = applyConversationStatePatch(groundedAvailability(2), { selectedRoomNumbers: ["101"] });
  const ambiguous = applyConversationStatePatch(threeFirst, { selectedRoomRelation: "other" });
  assert.deepEqual(canonicalSelectedRoomIds(ambiguous), [room101]);
  assert.equal(multiRoomConversationIssue(ambiguous), "which_rooms");
});

test("unknown room reference preserves prior grounded selection and forces clarification", () => {
  const selected = applyConversationStatePatch(groundedAvailability(4), { selectedRoomNumbers: ["101", "102"] });
  const invalid = applyConversationStatePatch(selected, { selectedRoomNumbers: ["101", "999"] });
  assert.deepEqual(canonicalSelectedRoomIds(invalid), [room101, room102]);
  assert.equal(multiRoomConversationIssue(invalid), "which_rooms");
});

test("invalid occupancy reference is never silently accepted", () => {
  const selected = applyConversationStatePatch(groundedAvailability(5), { selectedRoomNumbers: ["101", "102"] });
  const invalid = applyConversationStatePatch(selected, {
    roomOccupancy: [{ roomNumber: "101", guests: 2 }, { roomNumber: "999", guests: 3 }],
  });
  assert.deepEqual(invalid.roomOccupancy, []);
  assert.equal(multiRoomConversationIssue(invalid), "occupancy_distribution");
});

test("LLM router accepts bounded relational references and defines las dos / la otra ambiguity", async () => {
  let prompt = "";
  const provider = {
    async completeStructured(request) {
      prompt = request.messages[0].content;
      return {
        value: { kind: "message", toolId: "", input: {}, clarificationReason: "acknowledgement", missing: [], statePatch: { selectedRoomRelation: "both" } },
        model: "fake", inputTokens: 10, outputTokens: 5, latencyMs: 1, estimatedCostUsd: 0,
      };
    },
  };
  const router = new LLMModelRouter(provider, new DeterministicModelRouter());
  const result = await router.route("Me quedo con las dos", { now: "2026-08-31T12:00:00-03:00", tenant: { id: "hotel-r24" } }, [], [], groundedAvailability(4));
  assert.equal(result.kind, "message");
  assert.equal(result.statePatch.selectedRoomRelation, "both");
  assert.match(prompt, /las dos/i);
  assert.match(prompt, /la otra/i);
  assert.match(prompt, /never choose arbitrarily/i);
});
'''
test_path.write_text(tests)
