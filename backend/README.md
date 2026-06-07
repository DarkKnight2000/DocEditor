
```
doc_id:
        doc_name
        owner
        edit_collab
        <!-- clients:
            user_id:
                sync_rev_id
                sync_timestamp -->
        history:
            rev_id
            delta
        head:
            rev_id
            delta <- All deltas combined, new clients use this immediately
        last_edit
```****