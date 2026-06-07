<script>
    import Quill from "quill";
    import { Delta } from "quill";
    import "quill/dist/quill.snow.css";
    import { onDestroy, onMount, tick } from "svelte";
    import "$lib/styles/quill-editor.css";

    // sync status to show in nav bar
    let { sync_status = $bindable('Waiting...'), doc_id } = $props();

    const MessageTypes = {
        CLIENT_ID: 0,
        CLIENT_REV: 1,
        SERVER_REV: 2,
        SERVER_ACK: 3,
        SERVER_INIT: 4,
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
        const socket = new WebSocket(`ws://localhost:8000/edit-socket/${doc_id}`);
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
        // console.log("qtool ", document.getElementById("editor-toolbar"));
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
                // console.log("An API call triggered this change.");
                return;
            }
            // else if (source == 'user') {
            //     console.log('A user action triggered this change.');
            // }
            // console.log(oldDelta.ops);
            ClientState.Y = ClientState.Y.compose(delta);
            console.log(ClientState.Y);
        });

        // // a happened, so what should b be, because reference changed
        // // if a happened before, retain 1 and then b
        // // if there are clashing inserts, where to give priority -> that is the second parameter for transform
        // same as "follows" in notes
        // const a = new Delta().insert('a');
        // const b = new Delta().insert('b').retain(5).insert('c');

        // const composed = a.transform(b, true);
        // console.log(composed.ops);
        // const composed2 = a.transform(b, false);
        // console.log(composed2.ops);

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
            // console.log("x", ClientState.X);
            // console.log("y", ClientState.Y);
        }, 500);

        // receive content from server
        socket.addEventListener("message", (event) => {
            console.log("Got message from server:", event);
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
                    // console.log("B", B);
                    // console.log("A", ClientState.A);
                    // console.log("X", ClientState.X);
                    // console.log("Y", ClientState.Y);
                    // console.log("copm", ClientState.A.compose(B));
                    const An = ClientState.A.compose(B);
                    const Xn = B.transform(ClientState.X, true);
                    const Yn = ClientState.X.transform(B, false).transform(ClientState.Y);
                    const D = ClientState.Y.transform(ClientState.X.transform(B, false));
                    ClientState.A = An;
                    ClientState.X = Xn;
                    ClientState.Y = Yn;
                    ClientState.rev_id = recv_data.rev;
                    // console.log("delta", D)
                    // console.log("An", An)
                    // console.log("Xn", Xn)
                    // console.log("Yn", Yn)
                    quill.updateContents(D, "api");
                } else if (recv_data.type == MessageTypes.SERVER_INIT) {
                    // initial changes
                    // console.log("server init", recv_data.content)
                    // console.log("server init", JSON.parse(recv_data.content))
                    ClientState.rev_id = recv_data.rev;
                    ClientState.A = new Delta(JSON.parse(recv_data.content));
                    // console.log(ClientState.A);
                    quill.setContents(ClientState.A);
                    sync_status = 'Saved !';
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
            <button class="ql-list" title="Clean button" value="ordered"></button>
            <button class="ql-list" title="Clean button" value="bullet"></button>
            <button class="ql-link" title="Clean button" value="bullet"></button>
            <!-- <select class="ql-color">
                <option selected></option>
                <option value="#e60000"></option>
                <option value="#ff9900"></option>
                <option value="#ffff00"></option>
                <option value="#008a00"></option>
                <option value="#0066cc"></option>
                <option value="#9933ff"></option>
                <option value="#ffffff"></option>
                <option value="#facccc"></option>
                <option value="#ffebcc"></option>
                <option value="#ffffcc"></option>
                <option value="#cce8cc"></option>
                <option value="#cce0f5"></option>
                <option value="#ebd6ff"></option>
                <option value="#bbbbbb"></option>
                <option value="#f06666"></option>
                <option value="#ffc266"></option>
                <option value="#ffff66"></option>
                <option value="#66b966"></option>
                <option value="#66a3e0"></option>
                <option value="#c285ff"></option>
                <option value="#888888"></option>
                <option value="#a10000"></option>
                <option value="#b26b00"></option>
                <option value="#b2b200"></option>
                <option value="#006100"></option>
                <option value="#0047b2"></option>
                <option value="#6b24b2"></option>
                <option value="#444444"></option>
                <option value="#5c0000"></option>
                <option value="#663d00"></option>
                <option value="#666600"></option>
                <option value="#003700"></option>
                <option value="#002966"></option>
                <option value="#3d1466"></option>
            </select> -->
        </span>
        <span 
        class="ql-formats">
            <!-- <button class="ql-code-block" title="Clean button" value="super"></button> -->
            <button class="ql-color" title="Clean button" value="super"></button>
            <button class="ql-background" title="Clean button" value="super"></button>
            <button class="ql-clean" title="Clean button" value="super"></button>
        </span>
    </div>
    <div class="bg-gray-100 px-100 py-10 flex-1 border-t-gray-800">
        <div
            id="editor"
            class="bg-white text-sm text-black focus:outline-none text-left px-10 py-15"
        ></div>
    </div>
</div>
