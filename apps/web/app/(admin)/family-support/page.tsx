"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createLagosDateTime, drawingPurposeSchema, formatLagosDate, getLagosBusinessDate } from "@fabtyna/shared";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { accountingApi, familySupportApi } from "@/lib/api";
import type { FamilyMemberDto } from "@/lib/api/family-support.api";
import { toUserMessage } from "@/lib/api/client";
import { invalidateReportsAndBalances } from "@/lib/invalidate-after-write";
import type { WriteOperation } from "@/lib/write-messages";

const purposes = drawingPurposeSchema.options;
const label = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
type Operation = { message: WriteOperation; run: (key: string) => Promise<unknown> };

export default function FamilySupportPage() {
  const queryClient = useQueryClient();
  const flow = useWriteFlow();
  const today = getLagosBusinessDate();
  const [from, setFrom] = useState(today.slice(0, 7) + "-01");
  const [to, setTo] = useState(today);
  const [filterMember, setFilterMember] = useState("");
  const [filterPurpose, setFilterPurpose] = useState("");
  const [filterAccount, setFilterAccount] = useState("");
  const [memberId, setMemberId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [moneyKey, setMoneyKey] = useState(0);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [editing, setEditing] = useState<FamilyMemberDto | null>(null);
  const [reverseId, setReverseId] = useState("");
  const [reason, setReason] = useState("");
  const [last, setLast] = useState<Operation | null>(null);
  const [formError, setFormError] = useState("");
  const members = useQuery({ queryKey: ["family-support", "members"], queryFn: () => familySupportApi.listMembers() });
  const accounts = useQuery({ queryKey: ["family-support", "accounts"], queryFn: () => accountingApi.listAccounts() });
  const validRange = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const drawings = useQuery({
    queryKey: ["family-support", "drawings", from, to, filterMember, filterPurpose, filterAccount],
    queryFn: () => familySupportApi.listDrawings({
      from, to,
      ...(filterMember ? { beneficiaryId: filterMember } : {}),
      ...(filterPurpose ? { purpose: drawingPurposeSchema.parse(filterPurpose) } : {}),
      ...(filterAccount ? { accountId: filterAccount } : {}),
    }),
    enabled: validRange,
  });
  const paymentAccounts = (accounts.data ?? []).filter((account) => account.isActive && (account.type === "CASH" || account.type === "BANK"));
  const selectedAccount = accountId || paymentAccounts.find((account) => account.type === "CASH")?.id || paymentAccounts[0]?.id || "";

  async function perform(operation: Operation) {
    setLast(operation);
    setFormError("");
    const result = await flow.run(operation.message, operation.run);
    if (result !== undefined) {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["family-support"] }), invalidateReportsAndBalances(queryClient)]);
      setReverseId("");
      setReason("");
      setEditing(null);
      setName("");
      setRelationship("");
      if (operation.message === "drawing.create") {
        setAmount("");
        setNote("");
        setMoneyKey((value) => value + 1);
      }
    }
  }
  function record(event: FormEvent) {
    event.preventDefault();
    if (!memberId || !purpose || !selectedAccount || !/^[1-9]\d*$/.test(amount)) {
      setFormError("Select a beneficiary, purpose and account, and enter an amount greater than zero.");
      return;
    }
    try {
      const input = {
        beneficiaryId: memberId, purpose: drawingPurposeSchema.parse(purpose), accountId: selectedAccount, amountKobo: amount,
        occurredAt: createLagosDateTime(date).toISOString(), note: note.trim() || null,
      };
      void perform({ message: "drawing.create", run: (key) => familySupportApi.createDrawing(input, key) });
    } catch (error) {
      setFormError(toUserMessage(error));
    }
  }
  function saveMember(event: FormEvent) {
    event.preventDefault();
    const input = { name, relationship };
    void perform(editing
      ? { message: "familyMember.update", run: (key) => familySupportApi.updateMember(editing.id, input, key) }
      : { message: "familyMember.create", run: (key) => familySupportApi.createMember(input, key) });
  }
  const change = () => { flow.edit(); setFormError(""); };
  return (
    <div className="space-y-6">
      <PageHeader title="Family Support / Owner's Drawings" description="Money taken out by the owner is not a business expense. Reversals return the money to the original account." />
      {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
      <WriteFlowStatus flow={flow} onRetry={() => { if (last) void perform(last); }} checkHref="/family-support" checkLabel="View history" />
      {(members.error || accounts.error || drawings.error) && <p role="alert" className="text-danger">{toUserMessage(members.error || accounts.error || drawings.error)}</p>}
      <Card><CardHeader title="Record a drawing" /><CardBody>
        <form onSubmit={record} className="grid gap-3 md:grid-cols-2">
          <FormField id="drawing-member" label="Beneficiary"><Select id="drawing-member" value={memberId} required onChange={(e) => { change(); setMemberId(e.target.value); }}><option value="">Select beneficiary</option>{members.data?.filter((m) => m.isActive).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></FormField>
          <FormField id="drawing-purpose" label="Purpose"><Select id="drawing-purpose" value={purpose} required onChange={(e) => { change(); setPurpose(e.target.value); }}><option value="">Select purpose</option>{purposes.map((p) => <option key={p} value={p}>{label(p)}</option>)}</Select></FormField>
          <FormField id="drawing-account" label="Paid from"><Select id="drawing-account" value={selectedAccount} required onChange={(e) => { change(); setAccountId(e.target.value); }}><option value="">Select account</option>{paymentAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type === "CASH" ? "Cash" : "Bank transfer"})</option>)}</Select></FormField>
          <div className="text-sm self-end">Available: {paymentAccounts.find((a) => a.id === selectedAccount)?.balanceKobo !== undefined ? <Money kobo={BigInt(paymentAccounts.find((a) => a.id === selectedAccount)!.balanceKobo!)} /> : "Loading balance..."}</div>
          <MoneyInput key={moneyKey} id="drawing-amount" label="Amount" defaultValueKobo="0" onKoboChange={(v) => { change(); setAmount(v); }} />
          <FormField id="drawing-date" label="Date"><Input id="drawing-date" type="date" max={today} required value={date} onChange={(e) => { change(); setDate(e.target.value); }} /></FormField>
          <FormField id="drawing-note" label="Note (optional)"><Textarea id="drawing-note" value={note} maxLength={500} onChange={(e) => { change(); setNote(e.target.value); }} /></FormField>
          <div className="self-end"><Button type="submit" loading={flow.pending}>Record drawing</Button></div>
        </form>
      </CardBody></Card>
      <Card><CardHeader title="Beneficiaries" description="Add the owner and family members before recording drawings." /><CardBody className="space-y-4">
        <form onSubmit={saveMember} className="grid gap-3 md:grid-cols-3">
          <FormField id="member-name" label="Name"><Input id="member-name" required maxLength={120} value={name} onChange={(e) => { change(); setName(e.target.value); }} /></FormField>
          <FormField id="member-relationship" label="Relationship"><Input id="member-relationship" required maxLength={120} value={relationship} onChange={(e) => { change(); setRelationship(e.target.value); }} /></FormField>
          <div className="flex items-end gap-2"><Button type="submit" loading={flow.pending}>{editing ? "Save changes" : "Add beneficiary"}</Button>{editing && <Button variant="secondary" onClick={() => { change(); setEditing(null); setName(""); setRelationship(""); }}>Cancel</Button>}</div>
        </form>
        <ul className="space-y-2">{members.data?.map((m) => <li key={m.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-2"><span className="mr-auto">{m.name} — {m.relationship}{!m.isActive && " (inactive)"}</span><Button size="sm" variant="secondary" disabled={flow.pending} onClick={() => { change(); setEditing(m); setName(m.name); setRelationship(m.relationship); }}>Edit</Button><Button size="sm" variant="secondary" disabled={flow.pending} onClick={() => { change(); void perform({ message: "familyMember.active", run: (key) => familySupportApi.setMemberActive(m.id, !m.isActive, key) }); }}>{m.isActive ? "Deactivate" : "Reactivate"}</Button></li>)}</ul>
      </CardBody></Card>
      <Card><CardHeader title="Drawing history and totals" description="Totals exclude reversed drawings." /><CardBody className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <FormField id="history-from" label="From"><Input id="history-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></FormField>
          <FormField id="history-to" label="To"><Input id="history-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></FormField>
          <FormField id="history-member" label="Beneficiary"><Select id="history-member" value={filterMember} onChange={(e) => setFilterMember(e.target.value)}><option value="">All</option>{members.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></FormField>
          <FormField id="history-purpose" label="Purpose"><Select id="history-purpose" value={filterPurpose} onChange={(e) => setFilterPurpose(e.target.value)}><option value="">All</option>{purposes.map((p) => <option key={p} value={p}>{label(p)}</option>)}</Select></FormField>
          <FormField id="history-account" label="Account"><Select id="history-account" value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}><option value="">All</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></FormField>
        </div>
        {!validRange && <p role="alert" className="text-danger">Enter a valid date range.</p>}
        {drawings.isLoading && <p>Loading drawings...</p>}
        {drawings.data && <>
          <p className="font-semibold">Total: <Money kobo={BigInt(drawings.data.report.totalKobo)} /> ({drawings.data.report.count})</p>
          <div className="grid gap-4 md:grid-cols-3">
            <div><h3 className="font-semibold">By beneficiary</h3>{drawings.data.report.byBeneficiary.map((r) => <div key={r.id}>{r.name}: <Money kobo={BigInt(r.amountKobo)} />{r.byPurpose.map((p) => <div className="ml-3 text-sm" key={p.id}>{label(p.name)}: <Money kobo={BigInt(p.amountKobo)} /></div>)}</div>)}</div>
            <div><h3 className="font-semibold">By purpose</h3>{drawings.data.report.byPurpose.map((r) => <div key={r.id}>{label(r.name)}: <Money kobo={BigInt(r.amountKobo)} /></div>)}</div>
            <div><h3 className="font-semibold">By account</h3>{drawings.data.report.byAccount.map((r) => <div key={r.id}>{r.name}: <Money kobo={BigInt(r.amountKobo)} /></div>)}</div>
          </div>
          {drawings.data.items.length === 0 && <p>No drawings in this range.</p>}
          <ul className="space-y-2">{drawings.data.items.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-2"><div className="mr-auto">{formatLagosDate(new Date(row.occurredAt))} — {row.beneficiaryName} — {label(row.purpose)} — {row.accountName} — <Money kobo={BigInt(row.amountKobo)} />{row.reversed && " (reversed)"}{row.note && <div className="text-sm text-muted-foreground">{row.note}</div>}</div>{!row.reversed && <Button size="sm" variant="secondary" disabled={flow.pending} onClick={() => { change(); setReverseId(row.id); }}>Reverse</Button>}</li>)}</ul>
        </>}
      </CardBody></Card>
      <Modal open={reverseId !== ""} title="Reverse drawing" description="The amount will be returned to its original account." busy={flow.pending} onClose={() => setReverseId("")}>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const id = reverseId; const text = reason; void perform({ message: "drawing.reverse", run: (key) => familySupportApi.reverseDrawing(id, text, key) }); }}>
          <FormField id="reverse-reason" label="Reason"><Textarea id="reverse-reason" required maxLength={500} value={reason} onChange={(e) => { change(); setReason(e.target.value); }} /></FormField><Button type="submit" variant="danger" loading={flow.pending}>Reverse drawing</Button>
        </form>
      </Modal>
    </div>
  );
}
