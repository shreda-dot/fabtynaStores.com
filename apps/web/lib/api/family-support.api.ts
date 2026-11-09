import type { CreateDrawingInput, DrawingPurpose } from "@fabtyna/shared";

export type FamilyMemberDto = {
  id: string;
  name: string;
  relationship: string;
  isActive: boolean;
};

export type MockDrawing = {
  id: string;
  entryId: string;
  beneficiaryId: string;
  purpose: DrawingPurpose;
  sourceExpenseId: string | null;
};

export type DrawingFilter = {
  from: string;
  to: string;
  beneficiaryId?: string;
  purpose?: DrawingPurpose;
  accountId?: string;
};

export type DrawingItem = MockDrawing & {
  beneficiaryName: string;
  accountId: string;
  accountName: string;
  amountKobo: string;
  occurredAt: string;
  postedAt: string;
  note: string | null;
  reversed: boolean;
};

export type DrawingTotal = { id: string; name: string; amountKobo: string; count: number };
export type DrawingList = {
  items: DrawingItem[];
  report: {
    count: number;
    totalKobo: string;
    byBeneficiary: (DrawingTotal & { byPurpose: DrawingTotal[] })[];
    byPurpose: DrawingTotal[];
    byAccount: DrawingTotal[];
  };
};

export interface FamilySupportApi {
  listMembers(): Promise<FamilyMemberDto[]>;
  createMember(input: { name: string; relationship: string }, key?: string): Promise<FamilyMemberDto>;
  updateMember(id: string, input: { name: string; relationship: string }, key?: string): Promise<FamilyMemberDto>;
  setMemberActive(id: string, active: boolean, key?: string): Promise<FamilyMemberDto>;
  listDrawings(filter: DrawingFilter): Promise<DrawingList>;
  createDrawing(input: CreateDrawingInput, key?: string): Promise<unknown>;
  reverseDrawing(id: string, reason: string, key?: string): Promise<unknown>;
}
