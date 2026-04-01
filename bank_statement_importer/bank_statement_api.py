from __future__ import unicode_literals
import frappe
import json
import importlib


# ── Bank parser registry ───────────────────────────────────────────────────────
# Key   : exact Bank doctype name in ERPNext
# Value : dotted path to the parser class inside your app
#
# To add a new bank:
#   1. Create bank_parsers/<bank_short>.py with a class that has a parse(file_path) method
#   2. Add an entry here

BANK_PARSERS = {
    "ICICI Bank": "bank_statement_importer.bank_parsers.icici.ICICIParser",
    # "HDFC Bank":  "your_custom_app.bank_parsers.hdfc.HDFCParser",
    # "SBI":        "your_custom_app.bank_parsers.sbi.SBIParser",
}


# ── Helper: resolve parser class ───────────────────────────────────────────────

def _get_parser(bank_name):
    """Return an instantiated parser for the given bank, or raise a clear error."""
    class_path = BANK_PARSERS.get(bank_name)

    if not class_path:
        available = ", ".join(BANK_PARSERS.keys())
        frappe.throw(
            f"No parser is configured for <b>{bank_name}</b>.<br>"
            f"Currently supported banks: {available}"
        )

    module_path, class_name = class_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    return getattr(module, class_name)()


# ── Helper: resolve uploaded file path ─────────────────────────────────────────

def _file_path(file_url):
    """Convert a Frappe file URL to an absolute filesystem path."""
    file_doc = frappe.db.get_value(
        "File",
        {"file_url": file_url},
        ["file_name", "is_private"],
        as_dict=True,
    )
    if not file_doc:
        frappe.throw("Uploaded file not found. Please try uploading again.")

    if file_doc.is_private:
        return frappe.get_site_path("private", "files", file_doc.file_name)
    return frappe.get_site_path("public", "files", file_doc.file_name)


# ── API: parse statement ────────────────────────────────────────────────────────

@frappe.whitelist()
def parse_statement(file_url, bank):
    """
    Parse an uploaded bank statement and return a list of transaction dicts.
    Called from the browser after the file is uploaded to Frappe's file storage.

    Returns:
        list[dict] with keys: date, description, reference_number, deposit, withdrawal, currency
    """
    path = _file_path(file_url)
    parser = _get_parser(bank)
    transactions = parser.parse(path)
    return transactions


# ── API: create Bank Transactions ───────────────────────────────────────────────

@frappe.whitelist()
def create_bank_transactions(transactions, bank_account):
    """
    Bulk-create Bank Transaction docs from a JSON list.
    Skips rows that already exist (duplicate reference_number + bank_account).

    Returns:
        dict with keys: created, skipped, total, errors
    """
    if isinstance(transactions, str):
        transactions = json.loads(transactions)

    created = 0
    skipped = 0
    errors = []

    for txn in transactions:
        try:
            # Duplicate guard — only when a reference number is present
            ref = (txn.get("reference_number") or "").strip()
            if ref:
                already = frappe.db.exists(
                    "Bank Transaction",
                    {"reference_number": ref, "bank_account": bank_account},
                )
                if already:
                    skipped += 1
                    continue

            doc = frappe.get_doc({
                "doctype":          "Bank Transaction",
                "date":             txn["date"],
                "deposit":          _flt(txn.get("deposit")),
                "withdrawal":       _flt(txn.get("withdrawal")),
                "description":      (txn.get("description") or "")[:140],
                "reference_number": ref,
                "bank_account":     bank_account,
                "currency":         txn.get("currency") or "INR",
            })
            doc.insert(ignore_permissions=True)
            doc.submit()
            created += 1

        except Exception as exc:
            # Collect up to 10 errors without stopping the whole import
            if len(errors) < 10:
                errors.append(str(exc))
            continue

    frappe.db.commit()

    return {
        "created": created,
        "skipped": skipped,
        "total":   len(transactions),
        "errors":  errors,
    }


# ── Utility ─────────────────────────────────────────────────────────────────────

def _flt(value, precision=2):
    try:
        return round(float(value or 0), precision)
    except (TypeError, ValueError):
        return 0.0
