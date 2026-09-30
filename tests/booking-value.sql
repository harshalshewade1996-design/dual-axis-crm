-- Run after booking_value.sql; all fixtures roll back.
begin;
insert into public.leads(org_id,name,phone,status,budget,booking_value)
select id,'booking-value-test','',s,b,v from public.organizations cross join
(values ('Won',100000::numeric,75000.25::numeric),('Won',900000,null),('Won',1,0),('New',100000,50000)) as fixture(s,b,v)
where id=(select id from public.organizations order by created_at limit 1);
select status,sum(booking_value) as actual_value,count(*) filter(where booking_value is null) as missing
from public.leads where name='booking-value-test' group by status;
-- Expect Won: 75000.25 and 1 missing; New: 50000 (excluded from revenue).
do $$ begin
 begin
 update public.leads set booking_value=-1 where name='booking-value-test';
 raise exception 'Negative booking value was accepted';
 exception when check_violation then null;
 end;
end $$;
rollback;
