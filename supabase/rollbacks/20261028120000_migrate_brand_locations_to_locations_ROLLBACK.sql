-- Revierte la copia: quita de locations los places creados desde brand_locations (mismo marca + nombre + dirección).
delete from public.locations l
using ops.backup_brand_locations_20261028 b
where l.level = 'place' and l.brand_id = b.brand_id and l.name = b.name and l.address is not distinct from b.address;
