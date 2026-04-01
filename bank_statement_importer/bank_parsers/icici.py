from __future__ import unicode_literals
"""
ICICI Bank — Detailed Statement parser
=======================================

Expected XLS / XLSX layout
---------------------------
Row 0 : "DETAILED STATEMENT"          (title)
Row 1 : blank
Row 2 : blank
Row 3 : blank
Row 4 : blank
Row 5 : "Transactions List - <account name>"  (account info)
Row 6 : Column headers  →  No. | Transaction ID | Value Date | Txn Posted Date |
                            ChequeNo. | Description | Cr/Dr | Transaction Amount(INR) | Available Balance(INR)
Row 7+: Data rows

Output columns expected by ERPNext Bank Transaction
----------------------------------------------------
date             (YYYY-MM-DD)
description      (string)
reference_number (string)
deposit          (float)  — amount when Cr/Dr == "CR"
withdrawal       (float)  — amount when Cr/Dr == "DR"
currency         (string, always "INR")
"""

import pandas as pd
from datetime import datetime


class ICICIParser:

    # ── Layout constants ──────────────────────────────────────────────────
    SKIP_ROWS   = 6          # rows before the real header row
    DATE_COL    = "Value Date"
    AMOUNT_COL  = "Transaction Amount(INR)"
    CRDR_COL    = "Cr/Dr"
    DESC_COL    = "Description"
    TXNID_COL   = "Transaction ID"
    CHEQUE_COL  = "ChequeNo."
    DATE_FMT    = "%d/%m/%Y"
    CURRENCY    = "INR"

    # Columns that must be present; if any are missing we raise a clear error
    REQUIRED_COLS = [
        "Value Date",
        "Transaction Amount(INR)",
        "Cr/Dr",
        "Description",
        "Transaction ID",
    ]

    # ── Public API ────────────────────────────────────────────────────────

    def parse(self, file_path: str) -> list:
        """
        Parse the ICICI statement at *file_path* and return a list of
        transaction dicts ready for ERPNext Bank Transaction import.
        """
        df = self._read_file(file_path)
        self._validate_columns(df)
        return self._extract_rows(df)

    # ── Private helpers ───────────────────────────────────────────────────

    def _read_file(self, file_path: str) -> pd.DataFrame:
        try:
            if file_path.lower().endswith(".xls"):
                # Legacy binary format — requires xlrd
                df = pd.read_excel(
                    file_path,
                    engine="xlrd",
                    skiprows=self.SKIP_ROWS,
                    header=0,
                    dtype=str,         # read everything as text; we convert ourselves
                )
            else:
                # .xlsx / .xlsm
                df = pd.read_excel(
                    file_path,
                    skiprows=self.SKIP_ROWS,
                    header=0,
                    dtype=str,
                )
        except Exception as exc:
            raise ValueError(
                f"Could not read the file. Make sure it is a valid XLS or XLSX file.\n"
                f"Detail: {exc}"
            )

        # Strip leading/trailing whitespace from column names
        df.columns = [str(c).strip() for c in df.columns]
        return df

    def _validate_columns(self, df: pd.DataFrame):
        missing = [c for c in self.REQUIRED_COLS if c not in df.columns]
        if missing:
            raise ValueError(
                f"Expected column(s) not found: {', '.join(missing)}.\n"
                f"This parser is designed for ICICI Bank statements. "
                f"Please verify the file format."
            )

    def _extract_rows(self, df: pd.DataFrame) -> list:
        transactions = []

        for _, row in df.iterrows():
            # Skip completely empty rows
            if pd.isna(row.get(self.DATE_COL)) and pd.isna(row.get(self.AMOUNT_COL)):
                continue

            date = self._parse_date(row.get(self.DATE_COL))
            if date is None:
                continue   # skip rows with unparseable dates (e.g. summary lines)

            amount = self._parse_amount(row.get(self.AMOUNT_COL))
            if amount is None:
                continue

            cr_dr = str(row.get(self.CRDR_COL, "")).strip().upper()
            deposit    = amount if cr_dr == "CR" else 0.0
            withdrawal = amount if cr_dr == "DR" else 0.0

            reference = self._pick_reference(
                row.get(self.TXNID_COL, ""),
                row.get(self.CHEQUE_COL, ""),
            )

            description = str(row.get(self.DESC_COL, "")).strip()

            transactions.append({
                "date":             date,
                "description":      description,
                "reference_number": reference,
                "deposit":          deposit,
                "withdrawal":       withdrawal,
                "currency":         self.CURRENCY,
            })

        return transactions

    # ── Field-level parsers ───────────────────────────────────────────────

    def _parse_date(self, raw) -> str | None:
        """Return YYYY-MM-DD string or None."""
        if pd.isna(raw):
            return None
        s = str(raw).strip().split()[0]   # remove time component if present
        try:
            return datetime.strptime(s, self.DATE_FMT).strftime("%Y-%m-%d")
        except ValueError:
            pass
        try:
            # Fallback: let pandas infer the format
            return pd.to_datetime(s, dayfirst=True).strftime("%Y-%m-%d")
        except Exception:
            return None

    def _parse_amount(self, raw) -> float | None:
        """Return a positive float or None."""
        if pd.isna(raw):
            return None
        try:
            cleaned = str(raw).replace(",", "").strip()
            return abs(float(cleaned))
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _pick_reference(txn_id, cheque_no) -> str:
        """
        Prefer ChequeNo. when it is a real value (not "-" or blank),
        otherwise fall back to Transaction ID.
        """
        cheque = str(cheque_no).strip()
        if cheque and cheque not in ("-", "nan", "None", ""):
            return cheque
        return str(txn_id).strip()
