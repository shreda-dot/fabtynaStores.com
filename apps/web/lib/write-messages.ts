import { toast } from "@/stores/toast-store";

export type WriteMessageValues = {
  name?: string;
  reference?: string;
  amount?: string;
};

type Message = (values: WriteMessageValues) => string;

export const writeMessages = {
  "sale.create": ({ reference }) => reference ? `Sale ${reference} recorded.` : "Sale recorded.",
  "sale.amend": ({ reference }) => reference ? `Sale amended as ${reference}.` : "Sale amended.",
  "sale.void": ({ reference }) => reference ? `Sale ${reference} voided.` : "Sale voided.",
  "sale.payment": () => "Customer payment recorded.",
  "sale.payment.reverse": () => "Customer payment reversed.",
  "purchase.create": ({ reference }) => reference ? `Purchase ${reference} received.` : "Purchase received.",
  "purchase.amend": ({ reference }) => reference ? `Purchase amended as ${reference}.` : "Purchase amended.",
  "purchase.void": ({ reference }) => reference ? `Purchase ${reference} voided.` : "Purchase voided.",
  "purchase.payment": () => "Supplier payment recorded.",
  "purchase.payment.reverse": () => "Supplier payment reversed.",
  "payable.payment": ({ name }) => name ? `Payment recorded for ${name}.` : "Supplier payment recorded.",
  "account.create": ({ name }) => name ? `Account ${name} created.` : "Account created.",
  "account.rename": ({ name }) => name ? `Account renamed to ${name}.` : "Account renamed.",
  "account.deactivate": ({ name }) => name ? `Account ${name} deactivated.` : "Account deactivated.",
  "account.reactivate": ({ name }) => name ? `Account ${name} reactivated.` : "Account reactivated.",
  "account.opening": ({ name }) => name ? `Opening balance recorded for ${name}.` : "Opening balance recorded.",
  "account.reconcile": ({ name }) => name ? `${name} reconciled.` : "Account reconciled.",
  "account.transfer": ({ reference }) => reference ? `Transfer ${reference} recorded.` : "Account transfer recorded.",
  "account.transfer.reverse": () => "Account transfer reversed.",
  "account.entry.reverse": () => "Account entry reversed.",
  "account.movement": () => "Account movement recorded.",
  "expense.create": ({ amount }) => amount ? `Expense of ${amount} recorded.` : "Expense recorded.",
  "expense.amend": () => "Expense amended.",
  "expense.void": () => "Expense voided.",
  "expenseCategory.create": ({ name }) => name ? `Expense category ${name} created.` : "Expense category created.",
  "expenseCategory.rename": ({ name }) => name ? `Expense category renamed to ${name}.` : "Expense category renamed.",
  "expenseCategory.deactivate": ({ name }) => name ? `Expense category ${name} deactivated.` : "Expense category deactivated.",
  "expenseCategory.reactivate": ({ name }) => name ? `Expense category ${name} reactivated.` : "Expense category reactivated.",
  "transfer.create": ({ reference }) => reference ? `Transfer ${reference} saved.` : "Transfer saved.",
  "adjustment.create": ({ reference }) => reference ? `Adjustment ${reference} recorded.` : "Adjustment recorded.",
  "adjustment.void": ({ reference }) => reference ? `Adjustment ${reference} voided.` : "Adjustment voided.",
  "loan.create": ({ name }) => name ? `Loan from ${name} recorded.` : "Loan recorded.",
  "loan.charge": ({ name }) => name ? `Charge added to the ${name} loan.` : "Loan charge recorded.",
  "loan.repayment": ({ name }) => name ? `Repayment recorded for ${name}.` : "Loan repayment recorded.",
  "product.create": ({ name }) => name ? `Product ${name} created.` : "Product created.",
  "product.update": ({ name }) => name ? `Product ${name} updated.` : "Product updated.",
  "product.deactivate": ({ name }) => name ? `Product ${name} deactivated.` : "Product deactivated.",
  "product.reactivate": ({ name }) => name ? `Product ${name} reactivated.` : "Product reactivated.",
  "customer.create": ({ name }) => name ? `Customer ${name} created.` : "Customer created.",
  "customer.update": ({ name }) => name ? `Customer ${name} updated.` : "Customer updated.",
  "customer.deactivate": ({ name }) => name ? `Customer ${name} deactivated.` : "Customer deactivated.",
  "customer.reactivate": ({ name }) => name ? `Customer ${name} reactivated.` : "Customer reactivated.",
  "supplier.create": ({ name }) => name ? `Supplier ${name} created.` : "Supplier created.",
  "supplier.update": ({ name }) => name ? `Supplier ${name} updated.` : "Supplier updated.",
  "supplier.deactivate": ({ name }) => name ? `Supplier ${name} deactivated.` : "Supplier deactivated.",
  "supplier.reactivate": ({ name }) => name ? `Supplier ${name} reactivated.` : "Supplier reactivated.",
  "debtor.payment": ({ name }) => name ? `Payment recorded for ${name}.` : "Customer payment recorded.",
  "empties.opening": () => "Opening count recorded.",
  "empties.received": () => "Empties received.",
  "empties.returned": () => "Empties return recorded.",
  "empties.adjustment": () => "Empties adjustment recorded.",
  "empties.movement.reverse": () => "Empties movement reversed.",
  "empties.customer.taken": ({ name }) => name ? `Crates recorded as taken by ${name}.` : "Crates recorded as taken.",
  "empties.customer.returned": ({ name }) => name ? `Crates returned by ${name} recorded.` : "Customer crate return recorded.",
  "empties.customer.kept": ({ name }) => name ? `${name} kept the crates.` : "Customer kept the crates.",
  "empties.customer.adjustment": ({ name }) => name ? `Crate balance adjusted for ${name}.` : "Customer crate balance adjusted.",
  "empties.customer.reverse": () => "Customer crate movement reversed.",
  "empties.deposit.received": ({ name }) => name ? `Deposit from ${name} recorded.` : "Deposit recorded.",
  "empties.deposit.refunded": ({ name }) => name ? `Deposit refunded to ${name}.` : "Deposit refunded.",
  "empties.deposit.forfeited": ({ name }) => name ? `${name}'s deposit moved to your account.` : "Deposit moved to your account.",
  "empties.deposit.reverse": () => "Deposit entry reversed.",
  "empties.owner.create": ({ name }) => name ? `Brewery ${name} created.` : "Brewery created.",
  "empties.owner.rename": ({ name }) => name ? `Brewery renamed to ${name}.` : "Brewery renamed.",
  "empties.owner.deactivate": ({ name }) => name ? `Brewery ${name} deactivated.` : "Brewery deactivated.",
  "empties.owner.reactivate": ({ name }) => name ? `Brewery ${name} reactivated.` : "Brewery reactivated.",
  "empties.type.create": ({ name }) => name ? `Empties type ${name} created.` : "Empties type created.",
  "empties.type.update": ({ name }) => name ? `Empties type ${name} updated.` : "Empties type updated.",
  "empties.type.deactivate": ({ name }) => name ? `Empties type ${name} deactivated.` : "Empties type deactivated.",
  "empties.type.reactivate": ({ name }) => name ? `Empties type ${name} reactivated.` : "Empties type reactivated.",
  "empties.productOwner.assign": ({ name }) => name ? `${name} brewery assignment saved.` : "Brewery assignment saved.",
  "empties.productOwner.unassign": ({ name }) => name ? `${name} brewery assignment removed.` : "Brewery assignment removed.",
  "password.change": () => "Password changed. Other sessions have been signed out.",
  "demo.reset": () => "Demo data reset.",
} satisfies Record<string, Message>;

export type WriteOperation = keyof typeof writeMessages;

export type WriteMessageValue<T> =
  | WriteMessageValues
  | ((result: T) => WriteMessageValues);

export function getWriteMessage(
  operation: WriteOperation,
  values: WriteMessageValues = {},
): string {
  return writeMessages[operation](values);
}

export function notifyWriteSuccess(
  operation: WriteOperation,
  values?: WriteMessageValues,
): void {
  toast.success(getWriteMessage(operation, values));
}
