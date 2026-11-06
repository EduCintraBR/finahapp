CREATE TYPE "public"."stock_expiry_kind" AS ENUM('EXPIRY', 'REPLACE_BY');--> statement-breakpoint
CREATE TABLE "stock_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"check_date" date NOT NULL,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "repack_lot_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_products" ADD COLUMN "expiry_kind" "stock_expiry_kind" DEFAULT 'EXPIRY' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_products" ADD COLUMN "repack_shelf_life_months" smallint;--> statement-breakpoint
ALTER TABLE "stock_products" ADD COLUMN "check_every_months" smallint;--> statement-breakpoint
ALTER TABLE "stock_checks" ADD CONSTRAINT "stock_checks_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_checks" ADD CONSTRAINT "stock_checks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_checks_lot" ON "stock_checks" USING btree ("lot_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_repack_lot_id_stock_lots_id_fk" FOREIGN KEY ("repack_lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_repack_lot" ON "stock_movements" USING btree ("repack_lot_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_repack_lot" CHECK (("stock_movements"."kind" = 'REPACK_OUT') = ("stock_movements"."repack_lot_id" is not null));--> statement-breakpoint
ALTER TABLE "stock_products" ADD CONSTRAINT "stock_products_repack_months" CHECK ("stock_products"."repack_shelf_life_months" is null or "stock_products"."repack_shelf_life_months" between 1 and 240);--> statement-breakpoint
ALTER TABLE "stock_products" ADD CONSTRAINT "stock_products_check_months" CHECK ("stock_products"."check_every_months" is null or "stock_products"."check_every_months" between 1 and 60);