<script>
    import Quill from "quill";
    import { Delta } from "quill";
    import "quill/dist/quill.snow.css";
    import { onDestroy, onMount, tick } from "svelte";
    import "$lib/styles/quill-editor.css";
    import { page } from "$app/state";
    import { dev } from "$app/environment";
    import { createClientState, applyInit, applyLocalChange, takeOutgoing, applyAck, applyServerRev, exceedsCharLimit } from "$lib/sync_client.js";

    // sync status to show in nav bar
    let { sync_status = $bindable('Waiting...'), doc_id, ws_token, doc_name = $bindable(), noperm_dialog } = $props();

    const MessageTypes = {
        CLIENT_ID: 0,
        CLIENT_REV: 1,
        SERVER_REV: 2,
        SERVER_ACK: 3,
        SERVER_INIT: 4,
        SERVER_DOC_RENAME: 5,
        SERVER_DROP_ACCESS: 6,
        SERVER_DOC_LIMIT: 7
    };

    const ClientState = createClientState();

    // document length limit, sent by the server in SERVER_INIT
    let max_chars = $state(Infinity);
    let char_count = $state(0);
    let limit_hit = $state(false);
    let limit_hit_timer = -1;
    function flash_limit()
    {
        limit_hit = true;
        clearTimeout(limit_hit_timer);
        limit_hit_timer = setTimeout(() => limit_hit = false, 2500);
    }


    onMount(() => {
        // websocket
        let interval_id = -1;
        let ws_server_address = `ws://${page.url.host}/api`;
        if(dev)
        {
            ws_server_address = `ws://localhost:8000/api`;
        }
        const socket = new WebSocket(`${ws_server_address}/edit-socket/${doc_id}`);
        const client_id = crypto.randomUUID();
        socket.addEventListener("open", () => {
            // first message authenticates the socket; the server closes it if the token is invalid
            socket.send(JSON.stringify({ type: MessageTypes.CLIENT_ID, id: client_id, token: ws_token }));
            sync_status = 'Syncing...';
        });
        socket.addEventListener("close", () => {
            sync_status = 'Offline !';
        });
        socket.addEventListener("error", (err) => {
            console.log("Web socket error: ", err);
            sync_status = 'Error connecting to server!';
        });

        // editor
        const quill = new Quill("#editor", {
            theme: "snow",
            modules: {
                // syntax: true,
                toolbar: {
                    container: "#editor-toolbar",
                },
            },
            placeholder: "Start typing...",
        });
        // read-only until SERVER_INIT gives us the document and its revision
        let initialized = false;
        quill.disable();

        // characters typed, not counting the newline Quill always keeps at the end
        const text_length = () => quill.getLength() - 1;

        quill.on("text-change", (delta, oldContents, source) => {
            if (source == "api") {
                char_count = text_length();
                return;
            }
            const old_length = oldContents.length() - 1;
            if (exceedsCharLimit(old_length, text_length(), max_chars)) {
                // Undo the edit as a normal user change, so Quill's undo history and the sync state
                // record both the edit and its reversal (they cancel out) and stay consistent
                applyLocalChange(ClientState, delta);
                quill.updateContents(delta.invert(oldContents), "user");
                const at = typeof delta.ops[0]?.retain === "number" ? delta.ops[0].retain : 0;
                quill.setSelection(Math.min(at, text_length()), 0, "silent");
                flash_limit();
                return;
            }
            char_count = text_length();
            applyLocalChange(ClientState, delta);
        });

        // event loop
        interval_id = setInterval(() => {
            if (socket.readyState !== socket.OPEN || !initialized) return;
            // have new content and received ack for previously sent content
            const outgoing = takeOutgoing(ClientState);
            if (outgoing) {
                socket.send(JSON.stringify({ type: MessageTypes.CLIENT_REV, ...outgoing }));
                sync_status = 'Syncing...'
            }
        }, 500);

        // receive content from server
        socket.addEventListener("message", (event) => {
            try {
                const recv_data = JSON.parse(event.data);
                if (recv_data.type == MessageTypes.SERVER_ACK) {
                    // accepted my changes
                    applyAck(ClientState, recv_data.rev);
                    sync_status = 'Saved !';
                } else if (recv_data.type == MessageTypes.SERVER_REV) {
                    // other client changes
                    const B = new Delta(JSON.parse(recv_data.content));
                    const D = applyServerRev(ClientState, B, recv_data.rev);
                    quill.updateContents(D, "api");
                } else if (recv_data.type == MessageTypes.SERVER_INIT) {
                    applyInit(ClientState, recv_data.content, recv_data.rev);
                    max_chars = recv_data.max_chars ?? Infinity;
                    quill.setContents(ClientState.A);
                    char_count = text_length();
                    initialized = true;
                    quill.enable();
                    quill.focus();
                    sync_status = 'Saved !';
                } else if (recv_data.type == MessageTypes.SERVER_DOC_RENAME) {
                    // rename state variable in parent
                    doc_name = recv_data.name;
                } else if (recv_data.type == MessageTypes.SERVER_DROP_ACCESS) {
                    // removed as a collaborator, or "deleted" when the owner deleted the document
                    noperm_dialog(recv_data.reason);
                } else if (recv_data.type == MessageTypes.SERVER_DOC_LIMIT) {
                    // Edits from several people together went over the limit and the server refused
                    // this one. Reload to get back in sync with the saved document.
                    flash_limit();
                    sync_status = 'Document is full, reloading...';
                    quill.disable();
                    setTimeout(() => location.reload(), 2000);
                } else {
                    console.warn("Unknown message from server: ", recv_data);
                }
            } catch (error) {
                console.error("Error handling message from server:", error, event.data);
                sync_status = 'Error saving!';
            }
        });

        // called during unmount
        return () => {
            clearInterval(interval_id);
            socket.close();
        };
    });

    // onDestroy(() => {
    //     clearInterval(interval_id);
    // });
</script>

<div class="h-screen flex flex-col justify-stretch">
    <div
        id="editor-toolbar"
        class="text-sm text-black focus:outline-none text-left self-center"
    >
        <!-- Add font size dropdown -->
        <span class="ql-formats">
            <!-- Note a missing, thus falsy value, is used to reset to default -->
            <select class="ql-size">
                <option value="huge"></option>
                <option value="large"></option>
                <option selected></option>
                <option value="small"></option>
            </select>
            <!-- <select class="ql-header">
                <option value="1">Heading 1</option>
                <option value="2">Heading 2</option>
                <option value="3">Heading 3</option>
                <option value="">Normal</option>
            </select> -->
        </span>
        <!-- Add a bold button -->
        <span class="ql-formats">
            <button class="ql-bold" title="Bold button"></button>
            <button class="ql-italic" title="Italic button"></button>
            <button class="ql-underline" title="Underline button"></button>
            <button class="ql-strike" title="Strike button"></button>
        </span>
        <!-- Add subscript and superscript buttons -->
        <span class="ql-formats">
            <button class="ql-script" title="Superscript button" value="super"></button>
            <button class="ql-script" title="Subscript button" value="sub"></button>
        </span>
        <span class="ql-formats">
            <select class="ql-align">
                <option selected></option>
                <option value="center"></option>
                <option value="right"></option>
                <option value="justify"></option>
            </select>
            <button class="ql-list" title="Ordered list button" value="ordered"></button>
            <button class="ql-list" title="Unordered list button" value="bullet"></button>
            <button class="ql-link" title="Add link button" value="bullet"></button>
        </span>
        <span 
        class="ql-formats">
            <!-- <button class="ql-code-block" title="Clean button" value="super"></button> -->
            <!-- <button class="ql-color" title="Clean button" value="super"></button>
            <button class="ql-background" title="Clean button" value="super"></button> -->
            <button class="ql-clean" title="Clean button" value="super"></button>
        </span>
        {#if max_chars !== Infinity}
            <span class="ql-formats text-xs {limit_hit ? 'text-red-600 font-bold' : 'text-gray-400'}"
                title="Documents can have up to {max_chars} characters">
                {char_count} / {max_chars}{limit_hit ? ' (limit reached)' : ''}
            </span>
        {/if}
    </div>
    <div class="bg-gray-100 px-20 xl:px-40 2xl:px-80 py-10 flex-1 border-t-gray-800">
        <div
            id="editor"
            class="bg-white text-sm text-black focus:outline-none text-left px-10 py-15"
        ></div>
    </div>
</div>
