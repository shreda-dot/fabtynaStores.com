import { requestJson } from "./client";
import type { DrawingList, FamilyMemberDto, FamilySupportApi } from "./family-support.api";

const pathId = (id: string) => encodeURIComponent(id);

export const familySupportRealApi: FamilySupportApi = {
  listMembers: () => requestJson<FamilyMemberDto[]>("/family-members"),
  createMember: (input, idempotencyKey) =>
    requestJson<FamilyMemberDto>("/family-members", { method: "POST", body: input, idempotencyKey }),
  updateMember: (id, input, idempotencyKey) =>
    requestJson<FamilyMemberDto>(`/family-members/${pathId(id)}`, { method: "PATCH", body: input, idempotencyKey }),
  setMemberActive: (id, active, idempotencyKey) =>
    requestJson<FamilyMemberDto>(`/family-members/${pathId(id)}/${active ? "reactivate" : "deactivate"}`, { method: "POST", idempotencyKey }),
  listDrawings: (filter) => {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(filter)) {
      if (value !== undefined && value !== "") query.set(name, value);
    }
    return requestJson<DrawingList>(`/drawings?${query}`);
  },
  createDrawing: (input, idempotencyKey) =>
    requestJson("/drawings", { method: "POST", body: input, idempotencyKey }),
  reverseDrawing: (id, reason, idempotencyKey) =>
    requestJson(`/drawings/${pathId(id)}/reverse`, { method: "POST", body: { reason }, idempotencyKey }),
};
