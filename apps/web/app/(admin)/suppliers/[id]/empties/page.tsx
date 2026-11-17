"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SupplierEmpties } from "@/components/empties/supplier-empties";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { suppliersApi } from "@/lib/api";
import { ApiError, toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";

export default function SupplierEmptiesPage() {
  const { id } = useParams<{ id: string }>();
  const supplier = useQuery({
    queryKey: queryKeys.suppliers.detail(id),
    queryFn: () => suppliersApi.getById(id),
  });

  if (supplier.isPending) {
    return <div className="space-y-6"><Skeleton variant="text" className="h-8 w-56" /><Skeleton variant="card" count={2} /></div>;
  }
  if (supplier.isError) {
    if (supplier.error instanceof ApiError && supplier.error.kind === "not-found") {
      return (
        <EmptyState
          title="Supplier not found"
          description="This supplier may have been removed, or the link is incorrect."
          action={<Link href="/suppliers" className={buttonClasses({ variant: "secondary", size: "sm" })}>Back to suppliers</Link>}
        />
      );
    }
    return <ErrorState message={toUserMessage(supplier.error)} onRetry={() => void supplier.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${supplier.data.supplier.name} · Empties`}
        description="Track the containers owed to this supplier, separately from money payables."
        actions={
          <Link href={`/suppliers/${id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to supplier
          </Link>
        }
      />
      <SupplierEmpties supplierId={supplier.data.supplier.id} supplierName={supplier.data.supplier.name} />
    </div>
  );
}
