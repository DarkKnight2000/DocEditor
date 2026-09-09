<script>
    import Quill from "quill";
    import { Delta } from "quill";
    import "quill/dist/quill.snow.css";
    import { onDestroy, onMount, tick } from "svelte";
    import "$lib/styles/quill-editor.css";
    import { page } from "$app/state";
    import { dev } from "$app/environment";

    // sync status to show in nav bar
    let { sync_status = $bindable('Waiting...'), doc_id, doc_name = $bindable(), noperm_dialog } = $props();

    const MessageTypes = {
        CLIENT_ID: 0,
        CLIENT_REV: 1,
        SERVER_REV: 2,
        SERVER_ACK: 3,
        SERVER_INIT: 4,
        SERVER_DOC_RENAME: 5,
        SERVER_DROP_ACCESS: 6
    };

    const ClientState = {
        A: new Delta(),
        X: new Delta(),
        Y: new Delta(),
        rev_id: 0,
    };


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
            console.log("Web socket connection created!");
            socket.send(JSON.stringify({ type: MessageTypes.CLIENT_ID, id: client_id }));
            sync_status = 'Syncing...';
        });
        socket.addEventListener("close", () => {
            console.log("Web socket connection closed!");
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
        quill.focus();

        quill.on("text-change", (delta, _, source) => {
            if (source == "api") {
                return;
            }
            ClientState.Y = ClientState.Y.compose(delta);
        });

        // event loop
        interval_id = setInterval(() => {
            if (socket.readyState !== socket.OPEN) return;
            // have new content and received ack for previously sent content
            if (ClientState.Y.length() !== 0 && ClientState.X.length() === 0) {
                socket.send(
                    JSON.stringify({
                        type: MessageTypes.CLIENT_REV,
                        content: ClientState.Y.ops,
                        rev: ClientState.rev_id,
                    }),
                );
                ClientState.X = ClientState.Y;
                ClientState.Y = new Delta();
                sync_status = 'Syncing...'
            }
        }, 500);

        // receive content from server
        socket.addEventListener("message", (event) => {
            // console.log("Got message from server:", event);
            try {
                const recv_data = JSON.parse(event.data);
                if (recv_data.type == MessageTypes.SERVER_ACK) {
                    // accepted my changes
                    ClientState.A = ClientState.A.compose(ClientState.X);
                    ClientState.X = new Delta();
                    ClientState.rev_id = recv_data.rev;
                    sync_status = 'Saved !';
                } else if (recv_data.type == MessageTypes.SERVER_REV) {
                    // other client changes
                    const B = new Delta(JSON.parse(recv_data.content));
                    const An = ClientState.A.compose(B);
                    const Xn = B.transform(ClientState.X, true);
                    const Yn = ClientState.X.transform(B, false).transform(ClientState.Y);
                    const D = ClientState.Y.transform(ClientState.X.transform(B, false));
                    ClientState.A = An;
                    ClientState.X = Xn;
                    ClientState.Y = Yn;
                    ClientState.rev_id = recv_data.rev;
                    quill.updateContents(D, "api");
                } else if (recv_data.type == MessageTypes.SERVER_INIT) {
                    ClientState.rev_id = recv_data.rev;
                    ClientState.A = new Delta((recv_data.content));
                    quill.setContents(ClientState.A);
                    sync_status = 'Saved !';
                } else if (recv_data.type == MessageTypes.SERVER_DOC_RENAME) {
                    // rename state variable in parent
                    doc_name = recv_data.name;
                } else if (recv_data.type == MessageTypes.SERVER_DROP_ACCESS) {
                    // rename state variable in parent
                    noperm_dialog();
                } else {
                    console.log("No type: ", recv_data);
                }
            } catch (error) {
                console.error("Error parsing JSON:", error);
                console.log("Received data was:", event.data);
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
            <button class="ql-script" title="Superscript button" value="sub"></button>
            <button class="ql-script" title="Subscript button" value="super"></button>
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
    </div>
    <div class="bg-gray-100 px-20 xl:px-40 2xl:px-80 py-10 flex-1 border-t-gray-800">
        <div
            id="editor"
            class="bg-white text-sm text-black focus:outline-none text-left px-10 py-15"
        ></div>
    </div>
</div>
