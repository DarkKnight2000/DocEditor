export namespace main {
	
	export class Document {
	    path: string;
	    name: string;
	    autosave: boolean;
	    ops: number[];
	
	    static createFrom(source: any = {}) {
	        return new Document(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.autosave = source["autosave"];
	        this.ops = source["ops"];
	    }
	}
	export class RecentFile {
	    path: string;
	    name: string;
	    opened: string;
	
	    static createFrom(source: any = {}) {
	        return new RecentFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.opened = source["opened"];
	    }
	}

}

