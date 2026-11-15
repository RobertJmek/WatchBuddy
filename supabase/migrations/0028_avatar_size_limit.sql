-- 0028: a size limit on the avatars bucket.
--
-- 0026 left the bucket without one, so each file could be as large as the
-- project-wide default (50 MB). Measured in prod on 2026-11-15: 9 avatars,
-- 1.2 MB in total, the largest 332 KB, none over 1 MB.
--
-- 5 MB is more than fifteen times the largest real avatar. It still fits what
-- builds before 1.25.3 upload: the system's square crop as JPEG at quality 0.7,
-- not resized (a few MB for a phone photo at most). Builds since 1.25.3 upload
-- 512 x 512 JPEGs.
--
-- Backward compatible: files already stored are not checked. Only an upload
-- over 5 MB is refused, and no build produces one in normal use.
update storage.buckets
   set file_size_limit = 5242880 -- 5 MB
 where id = 'avatars';
