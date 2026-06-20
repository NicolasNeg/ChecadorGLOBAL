-- 0012: FK audit_log.admin_id → perfiles_admin(id)
-- PostgREST necesita una relación para poder embeber perfiles_admin(nombre).
-- admin_id ya apunta a auth.users(id) y perfiles_admin.id == auth.users.id (1:1),
-- así que también es válido referenciar perfiles_admin. NOT VALID evita fallar
-- por filas históricas con admin_id sin perfil; PostgREST detecta la relación igual.

alter table audit_log drop constraint if exists audit_log_admin_perfil_fk;
alter table audit_log
  add constraint audit_log_admin_perfil_fk
  foreign key (admin_id) references perfiles_admin(id) on delete set null
  not valid;
