CREATE TYPE "public"."credit_kind" AS ENUM('CARD', 'STORE_CREDIT');--> statement-breakpoint
ALTER TABLE "credit_cards" ALTER COLUMN "closing_day" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD COLUMN "kind" "credit_kind" DEFAULT 'CARD' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD COLUMN "first_due_days" smallint;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD COLUMN "close_before_days" smallint;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD COLUMN "original_amount_cents" bigint;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_kind_rule" CHECK (case "credit_cards"."kind"
    when 'CARD' then "credit_cards"."closing_day" is not null and "credit_cards"."first_due_days" is null and "credit_cards"."close_before_days" is null
    else "credit_cards"."closing_day" is null and "credit_cards"."first_due_days" between 2 and 120
      and "credit_cards"."close_before_days" between 1 and "credit_cards"."first_due_days" - 1 end);--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "plan_original_le_total" CHECK ("installment_plans"."original_amount_cents" is null or
    ("installment_plans"."original_amount_cents" > 0 and "installment_plans"."original_amount_cents" <= "installment_plans"."total_amount_cents"));