CREATE TYPE "public"."anticipation_settlement" AS ENUM('ON_INVOICE', 'DIRECT_PAYMENT');--> statement-breakpoint
CREATE TYPE "public"."bank_account_kind" AS ENUM('CHECKING', 'SAVINGS', 'CASH_WALLET');--> statement-breakpoint
CREATE TYPE "public"."bot_message_status" AS ENUM('RECEIVED', 'PARSED', 'AWAITING_CONFIRMATION', 'CREATED', 'REJECTED', 'UNDONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."bot_message_type" AS ENUM('TEXT', 'VOICE', 'COMMAND');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('EXPENSE', 'INCOME');--> statement-breakpoint
CREATE TYPE "public"."entry_source" AS ENUM('MANUAL', 'BOT', 'IMPORT', 'RECURRING', 'SYSTEM', 'ONBOARDING');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('PARSED', 'IN_REVIEW', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."import_format" AS ENUM('OFX', 'CSV');--> statement-breakpoint
CREATE TYPE "public"."import_kind" AS ENUM('BANK_STATEMENT', 'CARD_STATEMENT');--> statement-breakpoint
CREATE TYPE "public"."import_line_status" AS ENUM('PENDING_REVIEW', 'MATCHED', 'CREATED', 'IGNORED');--> statement-breakpoint
CREATE TYPE "public"."installment_plan_status" AS ENUM('ACTIVE', 'FINISHED', 'CANCELLED', 'FULLY_ANTICIPATED');--> statement-breakpoint
CREATE TYPE "public"."invoice_item_kind" AS ENUM('INSTALLMENT', 'ANTICIPATION', 'REFUND_CREDIT', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."invoice_item_status" AS ENUM('ACTIVE', 'ANTICIPATED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('OPEN', 'CLOSED', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('PIX', 'DEBIT', 'CASH', 'BOLETO', 'BANK_TRANSFER', 'AUTO_DEBIT', 'CREDIT_CARD', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."recurring_direction" AS ENUM('INCOME', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."recurring_type" AS ENUM('FIXED', 'RECURRING_VARIABLE');--> statement-breakpoint
CREATE TYPE "public"."refund_mode" AS ENUM('CREDIT_KEEP_INSTALLMENTS', 'CANCEL_PURCHASE');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM('INCOME', 'EXPENSE', 'INVOICE_PAYMENT', 'ANTICIPATION_PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('PENDING', 'POSTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "anticipation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installment_plan_id" uuid NOT NULL,
	"anticipation_date" date NOT NULL,
	"installments_count" smallint NOT NULL,
	"gross_amount_cents" bigint NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"paid_amount_cents" bigint NOT NULL,
	"settlement" "anticipation_settlement" NOT NULL,
	"target_invoice_id" uuid,
	"payment_transaction_id" uuid,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anticipation_records_payment_transaction_id_unique" UNIQUE("payment_transaction_id"),
	CONSTRAINT "antic_count" CHECK ("anticipation_records"."installments_count" >= 1),
	CONSTRAINT "antic_math" CHECK ("anticipation_records"."gross_amount_cents" - "anticipation_records"."discount_cents" = "anticipation_records"."paid_amount_cents"),
	CONSTRAINT "antic_non_negative" CHECK ("anticipation_records"."discount_cents" >= 0 and "anticipation_records"."paid_amount_cents" > 0),
	CONSTRAINT "antic_settlement" CHECK (
    ("anticipation_records"."settlement" = 'ON_INVOICE' and "anticipation_records"."target_invoice_id" is not null and "anticipation_records"."payment_transaction_id" is null)
    or ("anticipation_records"."settlement" = 'DIRECT_PAYMENT' and "anticipation_records"."payment_transaction_id" is not null and "anticipation_records"."target_invoice_id" is null))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid,
	"entity" varchar(60) NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" varchar(30) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balance_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"checkpoint_date" date NOT NULL,
	"statement_balance_cents" bigint NOT NULL,
	"computed_balance_cents" bigint NOT NULL,
	"adjustment_transaction_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_checkpoints_account_date" UNIQUE("bank_account_id","checkpoint_date")
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"kind" "bank_account_kind" DEFAULT 'CHECKING' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"opening_balance_cents" bigint DEFAULT 0 NOT NULL,
	"opening_balance_date" date NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_update_id" bigint NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"message_type" "bot_message_type" NOT NULL,
	"raw_text" text,
	"transcription" text,
	"parsed_payload" jsonb,
	"confidence" smallint,
	"status" "bot_message_status" DEFAULT 'RECEIVED' NOT NULL,
	"transaction_id" uuid,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_messages_telegram_update_id_unique" UNIQUE("telegram_update_id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"kind" "category_kind" NOT NULL,
	"parent_id" uuid,
	"icon" varchar(40),
	"color" varchar(16),
	"bot_aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_kind_parent_name" UNIQUE NULLS NOT DISTINCT("kind","parent_id","name")
);
--> statement-breakpoint
CREATE TABLE "credit_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"issuer" varchar(60),
	"last4" varchar(4),
	"is_additional" boolean DEFAULT false NOT NULL,
	"holder_name" varchar(80),
	"limit_total_cents" bigint,
	"closing_day" smallint NOT NULL,
	"due_day" smallint NOT NULL,
	"payment_account_id" uuid NOT NULL,
	"bot_aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_cards_limit_positive" CHECK ("credit_cards"."limit_total_cents" is null or "credit_cards"."limit_total_cents" >= 0),
	CONSTRAINT "credit_cards_additional_holder" CHECK (not "credit_cards"."is_additional" or "credit_cards"."holder_name" is not null),
	CONSTRAINT "credit_cards_closing_day" CHECK ("credit_cards"."closing_day" between 1 and 31),
	CONSTRAINT "credit_cards_due_day" CHECK ("credit_cards"."due_day" between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "import_kind" NOT NULL,
	"format" "import_format" NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_sha256" varchar(64) NOT NULL,
	"bank_account_id" uuid,
	"credit_card_id" uuid,
	"invoice_id" uuid,
	"status" "import_batch_status" DEFAULT 'PARSED' NOT NULL,
	"period_start" date,
	"period_end" date,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_file_sha256_unique" UNIQUE("file_sha256"),
	CONSTRAINT "import_target" CHECK (
    ("import_batches"."kind" = 'BANK_STATEMENT' and "import_batches"."bank_account_id" is not null and "import_batches"."credit_card_id" is null)
    or ("import_batches"."kind" = 'CARD_STATEMENT' and "import_batches"."credit_card_id" is not null and "import_batches"."bank_account_id" is null))
);
--> statement-breakpoint
CREATE TABLE "import_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"bank_account_id" uuid,
	"credit_card_id" uuid,
	"dedup_key" varchar(128) NOT NULL,
	"line_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"raw_description" text NOT NULL,
	"raw_payload" jsonb,
	"status" "import_line_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"match_score" smallint,
	"suggested_transaction_id" uuid,
	"suggested_invoice_item_id" uuid,
	"matched_transaction_id" uuid,
	"matched_invoice_item_id" uuid,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_one_target" CHECK (("import_lines"."bank_account_id" is null) <> ("import_lines"."credit_card_id" is null)),
	CONSTRAINT "line_matched_has_link" CHECK ("import_lines"."status" <> 'MATCHED' or
    "import_lines"."matched_transaction_id" is not null or "import_lines"."matched_invoice_item_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "installment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"total_amount_cents" bigint NOT NULL,
	"installment_count" smallint NOT NULL,
	"first_tracked_installment" smallint DEFAULT 1 NOT NULL,
	"purchase_date" date NOT NULL,
	"first_invoice_id" uuid NOT NULL,
	"status" "installment_plan_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_plans_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "plan_total_positive" CHECK ("installment_plans"."total_amount_cents" > 0),
	CONSTRAINT "plan_count" CHECK ("installment_plans"."installment_count" between 1 and 72),
	CONSTRAINT "plan_total_divisible" CHECK ("installment_plans"."total_amount_cents" >= "installment_plans"."installment_count"),
	CONSTRAINT "plan_first_tracked" CHECK ("installment_plans"."first_tracked_installment" between 1 and "installment_plans"."installment_count")
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"kind" "invoice_item_kind" NOT NULL,
	"status" "invoice_item_status" DEFAULT 'ACTIVE' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"description" varchar(200) NOT NULL,
	"posting_date" date NOT NULL,
	"installment_plan_id" uuid,
	"installment_number" smallint,
	"anticipation_record_id" uuid,
	"refund_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_installment_shape" CHECK ("invoice_items"."kind" <> 'INSTALLMENT' or (
    "invoice_items"."installment_plan_id" is not null and "invoice_items"."installment_number" >= 1 and "invoice_items"."amount_cents" > 0)),
	CONSTRAINT "item_anticipation_shape" CHECK ("invoice_items"."kind" <> 'ANTICIPATION' or (
    "invoice_items"."anticipation_record_id" is not null and "invoice_items"."installment_plan_id" is not null and "invoice_items"."amount_cents" > 0)),
	CONSTRAINT "item_refund_shape" CHECK ("invoice_items"."kind" <> 'REFUND_CREDIT' or (
    "invoice_items"."refund_record_id" is not null and "invoice_items"."amount_cents" < 0)),
	CONSTRAINT "item_adjustment_nonzero" CHECK ("invoice_items"."kind" <> 'ADJUSTMENT' or "invoice_items"."amount_cents" <> 0),
	CONSTRAINT "item_anticipated_link" CHECK ("invoice_items"."status" <> 'ANTICIPATED' or (
    "invoice_items"."kind" = 'INSTALLMENT' and "invoice_items"."anticipation_record_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"reference_month" date NOT NULL,
	"closing_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" "invoice_status" DEFAULT 'OPEN' NOT NULL,
	"paid_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_card_month" UNIQUE("credit_card_id","reference_month"),
	CONSTRAINT "invoices_card_closing" UNIQUE("credit_card_id","closing_date"),
	CONSTRAINT "invoices_due_after_closing" CHECK ("invoices"."due_date" > "invoices"."closing_date"),
	CONSTRAINT "invoices_reference_is_due_month" CHECK ("invoices"."reference_month" = date_trunc('month', "invoices"."due_date")::date),
	CONSTRAINT "invoices_paid_has_date" CHECK ("invoices"."status" <> 'PAID' or "invoices"."paid_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "recurring_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "recurring_type" NOT NULL,
	"direction" "recurring_direction" NOT NULL,
	"description" varchar(140) NOT NULL,
	"category_id" uuid NOT NULL,
	"expected_amount_cents" bigint NOT NULL,
	"day_of_month" smallint NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"bank_account_id" uuid,
	"credit_card_id" uuid,
	"start_month" date NOT NULL,
	"end_month" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"beneficiary_user_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_amount_positive" CHECK ("recurring_templates"."expected_amount_cents" > 0),
	CONSTRAINT "recurring_day" CHECK ("recurring_templates"."day_of_month" between 1 and 31),
	CONSTRAINT "recurring_start_is_month" CHECK (extract(day from "recurring_templates"."start_month") = 1),
	CONSTRAINT "recurring_end_after_start" CHECK ("recurring_templates"."end_month" is null or "recurring_templates"."end_month" >= "recurring_templates"."start_month"),
	CONSTRAINT "recurring_target" CHECK (
    ("recurring_templates"."payment_method" = 'CREDIT_CARD' and "recurring_templates"."credit_card_id" is not null and "recurring_templates"."bank_account_id" is null
       and "recurring_templates"."direction" = 'EXPENSE')
    or ("recurring_templates"."payment_method" <> 'CREDIT_CARD' and "recurring_templates"."credit_card_id" is null and "recurring_templates"."bank_account_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "refund_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"installment_plan_id" uuid NOT NULL,
	"mode" "refund_mode" NOT NULL,
	"refund_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"target_invoice_id" uuid,
	"reason" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_amount_positive" CHECK ("refund_records"."amount_cents" > 0),
	CONSTRAINT "refund_mode_a_needs_invoice" CHECK ("refund_records"."mode" <> 'CREDIT_KEEP_INSTALLMENTS' or "refund_records"."target_invoice_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"status" "transaction_status" DEFAULT 'POSTED' NOT NULL,
	"description" varchar(200) NOT NULL,
	"notes" text,
	"amount_cents" bigint NOT NULL,
	"estimated_amount_cents" bigint,
	"payment_method" "payment_method" NOT NULL,
	"bank_account_id" uuid,
	"credit_card_id" uuid,
	"category_id" uuid,
	"transaction_date" date NOT NULL,
	"due_date" date,
	"posted_date" date,
	"recurring_template_id" uuid,
	"occurrence_month" date,
	"paid_invoice_id" uuid,
	"transfer_group_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"beneficiary_user_id" uuid,
	"source" "entry_source" DEFAULT 'MANUAL' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tx_amount_positive" CHECK ("transactions"."amount_cents" > 0),
	CONSTRAINT "tx_target" CHECK (
    ("transactions"."payment_method" = 'CREDIT_CARD' and "transactions"."credit_card_id" is not null and "transactions"."bank_account_id" is null
       and "transactions"."kind" = 'EXPENSE')
    or ("transactions"."payment_method" <> 'CREDIT_CARD' and "transactions"."credit_card_id" is null and "transactions"."bank_account_id" is not null)),
	CONSTRAINT "tx_posted_has_date" CHECK ("transactions"."status" <> 'POSTED' or "transactions"."posted_date" is not null),
	CONSTRAINT "tx_pending_has_due" CHECK ("transactions"."status" <> 'PENDING' or "transactions"."due_date" is not null),
	CONSTRAINT "tx_invoice_payment_link" CHECK (("transactions"."kind" = 'INVOICE_PAYMENT') = ("transactions"."paid_invoice_id" is not null)),
	CONSTRAINT "tx_category_required" CHECK ("transactions"."kind" not in ('INCOME','EXPENSE') or "transactions"."category_id" is not null),
	CONSTRAINT "tx_recurring_pair" CHECK (("transactions"."recurring_template_id" is null) = ("transactions"."occurrence_month" is null)),
	CONSTRAINT "tx_transfer_group" CHECK ("transactions"."kind" not in ('TRANSFER_IN','TRANSFER_OUT') or "transactions"."transfer_group_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"email" varchar(160) NOT NULL,
	"password_hash" text NOT NULL,
	"telegram_user_id" bigint,
	"color" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_telegram_user_id_unique" UNIQUE("telegram_user_id")
);
--> statement-breakpoint
ALTER TABLE "anticipation_records" ADD CONSTRAINT "anticipation_records_installment_plan_id_installment_plans_id_fk" FOREIGN KEY ("installment_plan_id") REFERENCES "public"."installment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anticipation_records" ADD CONSTRAINT "anticipation_records_target_invoice_id_invoices_id_fk" FOREIGN KEY ("target_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anticipation_records" ADD CONSTRAINT "anticipation_records_payment_transaction_id_transactions_id_fk" FOREIGN KEY ("payment_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anticipation_records" ADD CONSTRAINT "anticipation_records_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_checkpoints" ADD CONSTRAINT "balance_checkpoints_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_checkpoints" ADD CONSTRAINT "balance_checkpoints_adjustment_transaction_id_transactions_id_fk" FOREIGN KEY ("adjustment_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_checkpoints" ADD CONSTRAINT "balance_checkpoints_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_messages" ADD CONSTRAINT "bot_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_messages" ADD CONSTRAINT "bot_messages_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_payment_account_id_bank_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_lines" ADD CONSTRAINT "import_lines_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_lines" ADD CONSTRAINT "import_lines_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_lines" ADD CONSTRAINT "import_lines_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_lines" ADD CONSTRAINT "import_lines_suggested_transaction_id_transactions_id_fk" FOREIGN KEY ("suggested_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_lines" ADD CONSTRAINT "import_lines_suggested_invoice_item_id_invoice_items_id_fk" FOREIGN KEY ("suggested_invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_lines" ADD CONSTRAINT "import_lines_matched_transaction_id_transactions_id_fk" FOREIGN KEY ("matched_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_lines" ADD CONSTRAINT "import_lines_matched_invoice_item_id_invoice_items_id_fk" FOREIGN KEY ("matched_invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_lines" ADD CONSTRAINT "import_lines_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_first_invoice_id_invoices_id_fk" FOREIGN KEY ("first_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_installment_plan_id_installment_plans_id_fk" FOREIGN KEY ("installment_plan_id") REFERENCES "public"."installment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_anticipation_record_id_anticipation_records_id_fk" FOREIGN KEY ("anticipation_record_id") REFERENCES "public"."anticipation_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_refund_record_id_refund_records_id_fk" FOREIGN KEY ("refund_record_id") REFERENCES "public"."refund_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_beneficiary_user_id_users_id_fk" FOREIGN KEY ("beneficiary_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_installment_plan_id_installment_plans_id_fk" FOREIGN KEY ("installment_plan_id") REFERENCES "public"."installment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_target_invoice_id_invoices_id_fk" FOREIGN KEY ("target_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_template_id_recurring_templates_id_fk" FOREIGN KEY ("recurring_template_id") REFERENCES "public"."recurring_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_paid_invoice_id_invoices_id_fk" FOREIGN KEY ("paid_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_beneficiary_user_id_users_id_fk" FOREIGN KEY ("beneficiary_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_single_primary" ON "bank_accounts" USING btree ("is_primary") WHERE "bank_accounts"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "bot_user_created" ON "bot_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "line_bank_dedup" ON "import_lines" USING btree ("bank_account_id","dedup_key") WHERE "import_lines"."bank_account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "line_card_dedup" ON "import_lines" USING btree ("credit_card_id","dedup_key") WHERE "import_lines"."credit_card_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "line_matched_tx" ON "import_lines" USING btree ("matched_transaction_id") WHERE "import_lines"."matched_transaction_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "line_matched_item" ON "import_lines" USING btree ("matched_invoice_item_id") WHERE "import_lines"."matched_invoice_item_id" is not null;--> statement-breakpoint
CREATE INDEX "line_batch_status" ON "import_lines" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX "plan_card_status" ON "installment_plans" USING btree ("credit_card_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "item_plan_number" ON "invoice_items" USING btree ("installment_plan_id","installment_number") WHERE "invoice_items"."kind" = 'INSTALLMENT';--> statement-breakpoint
CREATE INDEX "item_invoice" ON "invoice_items" USING btree ("invoice_id","status");--> statement-breakpoint
CREATE INDEX "item_card_status" ON "invoice_items" USING btree ("credit_card_id","status");--> statement-breakpoint
CREATE INDEX "invoices_card_due" ON "invoices" USING btree ("credit_card_id","due_date");--> statement-breakpoint
CREATE INDEX "refund_plan" ON "refund_records" USING btree ("installment_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tx_recurring_occurrence" ON "transactions" USING btree ("recurring_template_id","occurrence_month") WHERE "transactions"."recurring_template_id" is not null and "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tx_bank_posted" ON "transactions" USING btree ("bank_account_id","posted_date") WHERE "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tx_date" ON "transactions" USING btree ("transaction_date") WHERE "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tx_pending_due" ON "transactions" USING btree ("due_date") WHERE "transactions"."status" = 'PENDING' and "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tx_paid_invoice" ON "transactions" USING btree ("paid_invoice_id");--> statement-breakpoint
CREATE INDEX "tx_created_by" ON "transactions" USING btree ("created_by_user_id");