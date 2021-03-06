import { Mongo } from 'meteor/mongo';
import { _ } from 'meteor/underscore';
import { Tracker } from 'meteor/tracker';

class CollectionCache {
  constructor (sub, parentColl) {
    this.sub = sub;
    this.parentColl = parentColl;
    this.collection = new Mongo.Collection(null);
    this._observeCount = 0;
  }
  find (selector = {}, options = {}) {
    const sub = this.sub;

    this._omitDefault(options);
    this._track();

    Tracker.nonreactive(() => this.observe());
    /*
     * if inAll is not in options and neither _one or by default inAll is true
     * it will search in all documents
     *
     * 1- is in this way to allow pass true or false in inAll
     * 2- _one is used by findOne to always search in all documents unless inAll in cursor options is false
     */
    if (!('inAll' in options) && (options._one || this._searchInAll))
      options.inAll = true;

    return this.collection.find(sub._subParams && !options.inAll
      ? _.extend({_to: sub._params.get() || sub._subParams}, selector)
      : selector, options);
  }
  findOne (selector = {}, options = {}) {
    options.limit = 1;
    options._one = true;
    return this.find(selector, options).fetch()[0];
  }
  observe () {
    if (!this._tracker) {
      const {sub} = this;
      const observe = () => (
        Tracker.nonreactive(() => (
          this.parentColl.find().observeChanges({
            added: (id, doc) => {
              doc._toAt = (new Date()).getTime();

              const lastDoc = this.collection.findOne({_id: id});
              const to = sub._next || sub._subParams;

              if (lastDoc) {
                const op = {$set: doc};
                if (!_.contains(lastDoc._to, to))
                  op.$push = {_to: to};
                this.collection.update({_id: id}, op);
              } else {
                doc._id = id;
                doc._to = [to];
                this.collection.insert(doc);
              }
            },
            changed: (id, doc) => {
              this.collection.update({_id: id}, {$set: doc});
            },
            removed: (id) => {
              this.collection.remove(id);
            }
          })
        ))
      );
      const stop = () => {
        if (this._observe) {
          this._observe.stop();
          this._observe = null;
        }
      };

      this._tracker = Tracker.autorun(c => {
        if (sub._subReady.get()) {
          this._observe = observe();
        } else {
          stop();
        }
        c.onStop(stop);
      });
    }
  }
  _track () {
    if (Tracker.active) {
      this._observeCount ++;
      Tracker.onInvalidate(c => {
        Tracker.afterFlush(() => {
          this._observeCount --;

          if (c.stopped && !this._observeCount) {
            this._tracker.stop();
            this._tracker = null;
          }
        });
      });
    }
  }
  _omitDefault (options) {
    let fields = options.fields;
    if (fields) {
      for (let key in fields) {
        if (key !== '_id') {
          if (fields[key] === 0) {
            fields._to = 0;
            fields._toAt = 0;
          }
          break;
        }
      }
    } else
      options.fields = {_to: 0, _toAt: 0};
  }
};

export default CollectionCache;