# Database Migrations

This directory contains SQL migration scripts for the Cloudflare D1 database.

## Migration Order

Run these migrations in the following order:

1. **000_final_schema.sql** - Complete database schema with all tables and initial data
2. **001_add_module_options.sql** - Add module_options table (if not already included)
3. **002_add_ampere_columns.sql** - Add ampere columns to module_options table
4. **003_add_customers_table.sql** - Add customers table and customer_id to quote_configurations

## Usage

To apply migrations to your Cloudflare D1 database:

```bash
# Using wrangler
wrangler d1 execute <database-name> --file=migrations/000_final_schema.sql
wrangler d1 execute <database-name> --file=migrations/001_add_module_options.sql
wrangler d1 execute <database-name> --file=migrations/002_add_ampere_columns.sql
wrangler d1 execute <database-name> --file=migrations/003_add_customers_table.sql
```

## Notes

- All scripts use `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE` to avoid conflicts
- The final schema (000_final_schema.sql) contains the complete up-to-date database structure
- Individual migration scripts are provided for incremental updates