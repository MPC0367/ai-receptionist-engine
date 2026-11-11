-- English display names for read-back in English calls (Thai names are kept for Thai calls).
alter table service_variants add column name_en text;
alter table resources add column name_en text;
