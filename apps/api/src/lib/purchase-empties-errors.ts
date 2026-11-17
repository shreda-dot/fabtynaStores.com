const SETUP = "Check Purchase empties setup for this product, then try again.";
const REFRESH = "Refresh the purchase and its container check, then try again.";
const CORRECT = "Correct the linked supplier empties records first, then try again.";
const SUPPORT = "This container record could not be saved safely. Contact support before trying again.";

const triggerMessages: Record<string, string> = {
  "Empties type does not exist.": `The container type no longer exists. ${SETUP}`,
  "A supplier empties reversal must exactly negate its original event.": CORRECT,
  "Supplier empties balances are derived and cannot be written directly.": SUPPORT,
  "Supplier empties obligation not found.": "The supplier empties debt could not be found. Refresh the debts and try again.",
  "Supplier empties event does not match its obligation.": CORRECT,
  "Supplier empties event needs a tracked purchase.": "This purchase cannot be used for a new empties debt. Refresh the purchase and try again.",
  "Supplier empties debt must match the purchase supplier.": "Choose the supplier recorded on the purchase, then try again.",
  "A voided purchase cannot receive an empties settlement.": "This purchase was voided. Refresh the debts and choose an active debt.",
  "A settlement requires a live supplier empties obligation.": "This empties debt is no longer active. Refresh the debts and try again.",
  "On-hand movement must reference an original supplier empties event.": SUPPORT,
  "This supplier event must not move on-hand empties.": SUPPORT,
  "Supplier return needs an exact matching on-hand movement.": SUPPORT,
  "Correct the supplier event and its on-hand movement together.": "Correct the complete supplier empties settlement rather than its individual movement.",
  "A new purchase cannot start voided.": "Save a new purchase before voiding it.",
  "Purchase empties tracking metadata cannot be changed.": SUPPORT,
  "This old draft must be recreated with the empties check.": "Recreate this old draft so its containers can be checked before receiving it.",
  "A purchase cannot be received and voided in the same transaction.": "Save the purchase first, then void it in a separate action.",
  "A voided purchase cannot be reopened.": "Create a replacement purchase instead of reopening this voided purchase.",
  "A received purchase cannot return to draft.": "Void or amend the received purchase instead of returning it to draft.",
  "Correct the linked empties settlements before voiding or editing this purchase.": "Correct the linked empties settlements before voiding or editing this purchase.",
  "A supplier empties obligation needs exactly one matching debt origin.": SUPPORT,
  "Move a purchase packaging configuration by removing and recreating it.": "Clear the purchase container setup, change the brewery, then configure it again.",
  "A confirmed size cannot change while affected sales or purchases remain live.": "Void or correct the affected sales and purchases before changing this product's size.",
  "Classify this product in Purchase empties setup before saving it.": "Choose whether the product uses returnable containers before saving it.",
  "Historical purchase documents cannot receive new empties or lines.": "Create a replacement purchase rather than adding containers to this historical purchase.",
  "A received purchase cannot receive new lines or empties checks.": "Amend the purchase to change its lines or container check.",
  "A received purchase needs at least one line.": "Add at least one product to the purchase and try again.",
  "Every purchase line needs its matching empties classification snapshot.": SETUP,
  "Set up purchase empties classification and packaging for every product.": SETUP,
  "A purchase empties requirement does not match product packaging.": SETUP,
  "A purchase line is missing a configured container requirement.": SETUP,
  "A draft cannot commit purchase empties checks or events.": "Receive the purchase before recording its container returns.",
  "A voided purchase must have all its empties events reversed.": CORRECT,
  "A voided purchase must have its stock movements reversed.": "Correct the purchase's stock movements before voiding it.",
  "A purchase line is missing its empties classification or requirements.": SETUP,
  "Each received purchase line needs its matching unreversed stock movement.": "Refresh the purchase and its stock movements, then try again.",
  "Purchase empties events can only be reversed when the purchase is voided.": "Void or amend the purchase to correct its container returns.",
  "Purchase empties checks must cover each required container type.": REFRESH,
  "The purchase has an unresolved or incorrect empties shortage.": "The container shortage is not fully covered. Refresh the check and choose free supply or supplier debt for the exact shortfall.",
  "Purchase empties availability must be checked in the receipt transaction.": REFRESH,
  "An old purchase cannot receive a new original stock movement.": "Create a replacement purchase instead of adding stock to this historical purchase.",
};

const constraintMessages: Record<string, string> = {
  ck_purchase_empties_tracking_version: SUPPORT,
  purchase_empties_products_pkey: SETUP,
  fk_purchase_empties_products_product: "Choose an existing product, then update Purchase empties setup.",
  purchase_empties_packaging_pkey: "Choose only one container type per kind in Purchase empties setup.",
  ck_purchase_empties_packaging_counts: SETUP,
  purchase_empties_line_snapshots_pkey: REFRESH,
  fk_purchase_empties_line_snapshots_line: REFRESH,
  purchase_empties_requirements_pkey: REFRESH,
  fk_purchase_empties_requirements_line: REFRESH,
  fk_purchase_empties_requirements_type: SETUP,
  ck_purchase_empties_requirement_nonnegative: REFRESH,
  ck_purchase_empties_requirement_rates: SETUP,
  purchase_empties_checks_pkey: REFRESH,
  fk_purchase_empties_checks_purchase: REFRESH,
  fk_purchase_empties_checks_type: SETUP,
  ck_purchase_empties_checks_nonnegative: REFRESH,
  supplier_empties_obligations_pkey: SUPPORT,
  fk_supplier_empties_obligations_supplier: "Choose an existing supplier, then try again.",
  fk_supplier_empties_obligations_type: "Choose an existing empties type, then try again.",
  fk_supplier_empties_obligations_purchase: "Refresh the purchase and its supplier debts, then try again.",
  fk_supplier_empties_obligations_actor: SUPPORT,
  supplier_empties_events_pkey: SUPPORT,
  fk_supplier_empties_events_type: "Choose an existing empties type, then try again.",
  fk_supplier_empties_events_purchase: "Refresh the purchase and its supplier debts, then try again.",
  fk_supplier_empties_events_obligation: "Refresh the supplier empties debts, then try again.",
  fk_supplier_empties_events_reversal: "Refresh the supplier empties settlement history, then try again.",
  fk_supplier_empties_events_actor: SUPPORT,
  ck_supplier_empties_event_nonzero: "Enter a positive number of containers and try again.",
  supplier_empties_obligation_balances_pkey: SUPPORT,
  fk_supplier_empties_balances_obligation: SUPPORT,
  ck_supplier_empties_balance_nonnegative: "This return is greater than the outstanding empties debt. Refresh the debts and try again.",
  fk_empties_movements_supplier_event: CORRECT,
  ck_empties_supplier_event_source: CORRECT,
  ck_supplier_empties_event_source: CORRECT,
  ck_supplier_empties_event_sign: CORRECT,
  ck_supplier_empties_event_reason: "Enter a reason for the opening debt or correction and try again.",
  fk_purchase_empties_packaging_owner: "Assign the correct brewery before setting up purchase containers.",
  fk_purchase_empties_packaging_type: "Choose a container type owned by the product's brewery.",
  ux_supplier_empties_event_reversal: "This supplier empties record was already corrected. Refresh its history.",
  ux_supplier_empties_obligation_origin: "This supplier empties debt already has an origin. Refresh the debts.",
  ux_supplier_empties_purchase_event: REFRESH,
  ux_empties_supplier_event_original: CORRECT,
};

export function purchaseEmptiesErrorMessage(message: string | null, constraint: string | null): string | null {
  if (constraint !== null && Object.prototype.hasOwnProperty.call(constraintMessages, constraint)) {
    return constraintMessages[constraint]!;
  }
  if (message !== null) {
    for (const [source, friendly] of Object.entries(triggerMessages)) {
      if (message.includes(source)) return friendly;
    }
    for (const [name, friendly] of Object.entries(constraintMessages)) {
      if (message.includes(name)) return friendly;
    }
  }
  return null;
}
