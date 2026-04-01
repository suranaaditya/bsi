frappe.pages["bsi"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: "Bank Statement Importer",
		single_column: true,
	});
	new BankStatementImporter(wrapper);
};

class BankStatementImporter {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = wrapper.page;
		this.state = {
			step: 1,
			bank: null,
			bank_account: null,
			transactions: [],
			file_url: null,
			result: null,
		};
		this._inject_styles();
		this.$main = $(wrapper).find(".page-content").length
			? $(wrapper).find(".page-content")
			: $(wrapper).find(".main-section");
		console.log("main found:", this.$main.length, wrapper);
		this.$wrap = $('<div class="bsi-wrap">').appendTo(this.$main);
		this.refresh();
	}

	_inject_styles() {
		frappe.dom.set_style(`
			.bsi-wrap { max-width: 800px; margin: 1.5rem auto; padding: 0 1.25rem 3rem; }
			.bsi-stepper { display:flex; align-items:center; margin-bottom:1.75rem; }
			.bsi-step { display:flex; flex-direction:column; align-items:center; gap:5px; }
			.bsi-circle {
				width:30px; height:30px; border-radius:50%;
				display:flex; align-items:center; justify-content:center;
				font-size:12px; font-weight:500;
				border:1.5px solid var(--border-color);
				background:var(--bg-color); color:var(--text-muted);
			}
			.bsi-step.active .bsi-circle { background:var(--primary); border-color:var(--primary); color:#fff; }
			.bsi-step.done   .bsi-circle { background:var(--green);   border-color:var(--green);   color:#fff; }
			.bsi-step-lbl { font-size:11px; color:var(--text-muted); white-space:nowrap; }
			.bsi-step.active .bsi-step-lbl { color:var(--primary); font-weight:500; }
			.bsi-line { flex:1; height:1.5px; background:var(--border-color); margin:0 8px; margin-bottom:18px; }
			.bsi-line.done { background:var(--green); }
			.bsi-card { background:var(--card-bg); border:1px solid var(--border-color); border-radius:8px; padding:1.75rem 2rem 1.5rem; }
			.bsi-card-title { font-size:16px; font-weight:500; margin:0 0 4px; }
			.bsi-card-sub   { font-size:13px; color:var(--text-muted); margin:0 0 1.5rem; }
			.bsi-lbl { font-size:11px; font-weight:500; letter-spacing:.06em; text-transform:uppercase; color:var(--text-muted); margin-bottom:6px; display:block; }
			.bsi-field-wrap { margin-bottom:1.25rem; }
			.bsi-select { width:100%; padding:8px 12px; border:1px solid var(--border-color); border-radius:6px; background:var(--control-bg,#fff); color:var(--text-color); font-size:14px; height:38px; }
			.bsi-select:focus { outline:none; border-color:var(--primary); }
			.bsi-chip { display:inline-flex; align-items:center; gap:6px; font-size:12px; padding:4px 10px 4px 8px; border-radius:20px; background:var(--fg-color,#f5f5f5); border:1px solid var(--border-color); margin-bottom:1.25rem; }
			.bsi-chip-dot { width:8px; height:8px; border-radius:50%; background:var(--primary); }
			.bsi-dropzone { border:2px dashed var(--border-color); border-radius:8px; padding:2.25rem 1.5rem; text-align:center; cursor:pointer; transition:border-color .2s; }
			.bsi-dropzone:hover, .bsi-dropzone.over { border-color:var(--primary); background:rgba(71,118,230,.05); }
			.bsi-dropzone.has-file { border-color:var(--green); border-style:solid; }
			.bsi-dz-icon  { font-size:2rem; margin-bottom:.5rem; }
			.bsi-dz-title { font-size:14px; font-weight:500; margin-bottom:3px; }
			.bsi-dz-hint  { font-size:12px; color:var(--text-muted); }
			.bsi-table-wrap { overflow-x:auto; margin-top:1rem; border:1px solid var(--border-color); border-radius:6px; }
			.bsi-table { width:100%; border-collapse:collapse; font-size:12.5px; }
			.bsi-table th { background:var(--fg-color,#f5f5f5); padding:7px 12px; text-align:left; font-size:11px; font-weight:500; text-transform:uppercase; letter-spacing:.04em; color:var(--text-muted); border-bottom:1px solid var(--border-color); white-space:nowrap; }
			.bsi-table td { padding:7px 12px; border-bottom:1px solid var(--border-color); }
			.bsi-table tr:last-child td { border-bottom:none; }
			.bsi-table td.desc { max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
			.bsi-cr { color:#276749; font-weight:500; }
			.bsi-dr { color:#c53030; font-weight:500; }
			.bsi-footer { display:flex; justify-content:space-between; align-items:center; margin-top:1.5rem; }
			.bsi-status { font-size:13px; color:var(--text-muted); margin-top:1rem; }
			.bsi-alert-success { background:#f0fff4; border:1px solid #9ae6b4; border-radius:8px; padding:1.5rem; text-align:center; }
			.bsi-alert-err { background:#fff5f5; border:1px solid #feb2b2; border-radius:8px; padding:1rem; color:#c53030; font-size:13px; margin-top:1rem; }
		`);
	}

	refresh() {
		this.$wrap.empty();
		this._render_stepper();
		this.$card = $('<div class="bsi-card">').appendTo(this.$wrap);
		const fn = [null, "_step1", "_step2", "_step3", "_step4"][this.state.step];
		if (fn) this[fn](this.$card);
	}

	_render_stepper() {
		const steps = [
			{ n: 1, label: "Select bank" },
			{ n: 2, label: "Bank account" },
			{ n: 3, label: "Upload & preview" },
			{ n: 4, label: "Done" },
		];
		let html = `<div class="bsi-stepper">`;
		steps.forEach((s, i) => {
			const done = this.state.step > s.n;
			const active = this.state.step === s.n;
			html += `<div class="bsi-step ${active ? "active" : ""} ${done ? "done" : ""}">
				<div class="bsi-circle">${done ? "&#10003;" : s.n}</div>
				<div class="bsi-step-lbl">${s.label}</div>
			</div>`;
			if (i < steps.length - 1)
				html += `<div class="bsi-line ${done ? "done" : ""}"></div>`;
		});
		html += `</div>`;
		this.$wrap.append(html);
	}

	_step1($c) {
		$c.append(`
			<div class="bsi-card-title">Select bank</div>
			<div class="bsi-card-sub">Choose the bank whose statement you want to import.</div>
			<div class="bsi-field-wrap">
				<label class="bsi-lbl">Bank</label>
				<select class="bsi-select" id="bsi-bank-sel">
					<option value="">Loading banks...</option>
				</select>
			</div>
			<div class="bsi-footer">
				<div></div>
				<button class="btn btn-primary btn-sm" id="bsi-s1-next">Next &rarr;</button>
			</div>
		`);

		frappe.call({
			method: "frappe.client.get_list",
			args: { doctype: "Bank", fields: ["name"], limit_page_length: 100, order_by: "name asc" },
			callback: (r) => {
				const $sel = $c.find("#bsi-bank-sel");
				$sel.empty().append(`<option value="">-- Select bank --</option>`);
				(r.message || []).forEach((b) => {
					const sel = this.state.bank === b.name ? "selected" : "";
					$sel.append(`<option value="${b.name}" ${sel}>${b.name}</option>`);
				});
			},
		});

		$c.find("#bsi-s1-next").on("click", () => {
			const val = $c.find("#bsi-bank-sel").val();
			if (!val) return frappe.show_alert({ message: "Please select a bank", indicator: "orange" });
			this.state.bank = val;
			this.state.step = 2;
			this.refresh();
		});
	}

	_step2($c) {
		$c.append(`
			<div class="bsi-card-title">Select bank account</div>
			<div class="bsi-card-sub">Pick the ERPNext account linked to this bank.</div>
			<div class="bsi-chip"><span class="bsi-chip-dot"></span>${frappe.utils.escape_html(this.state.bank)}</div>
			<div class="bsi-field-wrap">
				<label class="bsi-lbl">Bank account</label>
				<select class="bsi-select" id="bsi-acc-sel">
					<option value="">Loading accounts...</option>
				</select>
			</div>
			<div class="bsi-footer">
				<button class="btn btn-default btn-sm" id="bsi-s2-back">&larr; Back</button>
				<button class="btn btn-primary btn-sm" id="bsi-s2-next">Next &rarr;</button>
			</div>
		`);

		frappe.call({
			method: "frappe.client.get_list",
			args: { doctype: "Bank Account", filters: { bank: this.state.bank }, fields: ["name"], limit_page_length: 100, order_by: "name asc" },
			callback: (r) => {
				const $sel = $c.find("#bsi-acc-sel");
				$sel.empty().append(`<option value="">-- Select account --</option>`);
				if (!r.message || !r.message.length) {
					$sel.empty().append(`<option value="">No accounts found for this bank</option>`);
					return;
				}
				r.message.forEach((a) => {
					const sel = this.state.bank_account === a.name ? "selected" : "";
					$sel.append(`<option value="${a.name}" ${sel}>${a.name}</option>`);
				});
			},
		});

		$c.find("#bsi-s2-back").on("click", () => { this.state.step = 1; this.refresh(); });
		$c.find("#bsi-s2-next").on("click", () => {
			const val = $c.find("#bsi-acc-sel").val();
			if (!val) return frappe.show_alert({ message: "Please select a bank account", indicator: "orange" });
			this.state.bank_account = val;
			this.state.step = 3;
			this.refresh();
		});
	}

	_step3($c) {
		$c.append(`
			<div class="bsi-card-title">Upload bank statement</div>
			<div class="bsi-card-sub">
				Bank: <strong>${frappe.utils.escape_html(this.state.bank)}</strong>
				&nbsp;&middot;&nbsp;
				Account: <strong>${frappe.utils.escape_html(this.state.bank_account)}</strong>
			</div>
			<div class="bsi-dropzone" id="bsi-drop">
				<div class="bsi-dz-icon">&#128196;</div>
				<div class="bsi-dz-title">Drop your XLS / XLSX file here</div>
				<div class="bsi-dz-hint">or click to browse</div>
				<input type="file" id="bsi-file" accept=".xls,.xlsx" style="display:none">
			</div>
			<div id="bsi-status"></div>
			<div id="bsi-preview"></div>
			<div class="bsi-footer">
				<button class="btn btn-default btn-sm" id="bsi-s3-back">&larr; Back</button>
				<button class="btn btn-primary btn-sm" id="bsi-s3-import" style="display:none">Import transactions</button>
			</div>
		`);

		const $drop = $c.find("#bsi-drop");
		const $file = $c.find("#bsi-file");
		$drop.on("click", function (e) {
			if (e.target === this || $(e.target).hasClass('bsi-dz-icon') || $(e.target).hasClass('bsi-dz-title') || $(e.target).hasClass('bsi-dz-hint')) {
				$file.click();
			}
		});
		$drop.on("dragover", (e) => { e.preventDefault(); $drop.addClass("over"); });
		$drop.on("dragleave drop", () => $drop.removeClass("over"));
		$drop.on("drop", (e) => { e.preventDefault(); const f = e.originalEvent.dataTransfer.files[0]; if (f) this._handle_file(f, $c); });
		$file.on("change", (e) => { const f = e.target.files[0]; if (f) this._handle_file(f, $c); });
		$c.find("#bsi-s3-back").on("click", () => { this.state.step = 2; this.refresh(); });
		$c.find("#bsi-s3-import").on("click", () => this._do_import($c));
	}

	_handle_file(file, $c) {
		const $drop = $c.find("#bsi-drop"), $status = $c.find("#bsi-status");
		const $preview = $c.find("#bsi-preview"), $btn = $c.find("#bsi-s3-import");
		$drop.addClass("has-file");
		$drop.find(".bsi-dz-title").text(file.name);
		$drop.find(".bsi-dz-hint").text("Uploading...");
		$preview.empty(); $btn.hide();
		$status.html(`<div class="bsi-status">Uploading ${frappe.utils.escape_html(file.name)}...</div>`);

		const fd = new FormData();
		fd.append("file", file); fd.append("is_private", "1");
		fd.append("cmd", "upload_file"); fd.append("csrf_token", frappe.csrf_token);

		fetch("/api/method/upload_file", { method: "POST", body: fd, headers: { "X-Frappe-CSRF-Token": frappe.csrf_token } })
			.then((r) => r.json())
			.then((res) => {
				if (!res.message || !res.message.file_url) throw new Error(res.exc || "Upload failed");
				this.state.file_url = res.message.file_url;
				$status.html(`<div class="bsi-status">Parsing statement...</div>`);
				return frappe.call({
					method: "bank_statement_importer.bank_statement_api.parse_statement",
					args: { file_url: this.state.file_url, bank: this.state.bank },
				});
			})
			.then((r) => {
				const txns = r.message;
				if (!txns || !txns.length) throw new Error("No transactions found. Is this an ICICI bank statement?");
				this.state.transactions = txns;
				$status.empty();
				$drop.find(".bsi-dz-hint").text(`${txns.length} transactions found — ready to import`);
				this._render_preview($c, txns);
				$btn.text(`Import ${txns.length} transactions`).show();
			})
			.catch((err) => {
				$status.html(`<div class="bsi-alert-err"><strong>Error:</strong> ${frappe.utils.escape_html(err.message || String(err))}</div>`);
				$drop.removeClass("has-file");
				$drop.find(".bsi-dz-title").text("Drop your XLS / XLSX file here");
				$drop.find(".bsi-dz-hint").text("or click to browse");
			});
	}

	_render_preview($c, txns) {
		const rows = txns.slice(0, 10);
		const fmt = (n) => n > 0 ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n) : "";
		const tbody = rows.map((t) => `
			<tr>
				<td>${frappe.utils.escape_html(t.date)}</td>
				<td class="desc" title="${frappe.utils.escape_html(t.description)}">${frappe.utils.escape_html(t.description)}</td>
				<td class="bsi-cr">${fmt(t.deposit)}</td>
				<td class="bsi-dr">${fmt(t.withdrawal)}</td>
				<td style="color:var(--text-muted);font-size:11px;">${frappe.utils.escape_html(t.reference_number || "")}</td>
			</tr>`).join("");
		const more = txns.length > 10 ? `<div style="text-align:center;font-size:12px;color:var(--text-muted);padding:.5rem 0;">...and ${txns.length - 10} more</div>` : "";
		$c.find("#bsi-preview").html(`
			<div class="bsi-table-wrap">
				<table class="bsi-table">
					<thead><tr><th>Date</th><th>Description</th><th>Deposit (CR)</th><th>Withdrawal (DR)</th><th>Reference</th></tr></thead>
					<tbody>${tbody}</tbody>
				</table>
			</div>${more}`);
	}

	_do_import($c) {
		const $btn = $c.find("#bsi-s3-import"), $status = $c.find("#bsi-status");
		$btn.prop("disabled", true).text("Importing...");
		$status.html(`<div class="bsi-status">Creating Bank Transaction records...</div>`);
		frappe.call({
			method: "bank_statement_importer.bank_statement_api.create_bank_transactions",
			args: { transactions: JSON.stringify(this.state.transactions), bank_account: this.state.bank_account },
			callback: (r) => { if (r.message) { this.state.result = r.message; this.state.step = 4; this.refresh(); } },
			error: () => {
				$btn.prop("disabled", false).text(`Import ${this.state.transactions.length} transactions`);
				$status.html(`<div class="bsi-alert-err">Import failed. Check the error log for details.</div>`);
			},
		});
	}

	_step4($c) {
		const r = this.state.result || {}, created = r.created || 0, skipped = r.skipped || 0, errors = r.errors || [];
		$c.append(`
			<div class="bsi-alert-success">
				<div style="font-size:2.5rem;margin-bottom:.5rem;">&#10003;</div>
				<div style="font-size:18px;font-weight:500;margin-bottom:.5rem;">Import complete</div>
				<div style="font-size:13px;color:#276749;">
					<strong>${created}</strong> transactions created
					${skipped ? `&nbsp;&middot;&nbsp;<strong>${skipped}</strong> duplicates skipped` : ""}
				</div>
			</div>
			${errors.length ? `<div class="bsi-alert-err" style="margin-top:1rem;"><strong>Some rows had errors:</strong><ul style="margin:.5rem 0 0;padding-left:1.25rem;">${errors.map((e) => `<li>${frappe.utils.escape_html(e)}</li>`).join("")}</ul></div>` : ""}
			<div class="bsi-footer" style="margin-top:1.75rem;">
				<button class="btn btn-default btn-sm" id="bsi-another">Import another statement</button>
				<a href="/app/bank-reconciliation-tool" class="btn btn-primary btn-sm">Go to Reconciliation Tool &rarr;</a>
			</div>
		`);
		$c.find("#bsi-another").on("click", () => {
			this.state = { step: 1, bank: null, bank_account: null, transactions: [], file_url: null, result: null };
			this.refresh();
		});
	}
}
