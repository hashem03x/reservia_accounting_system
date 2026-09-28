module.exports = async(callback, ...args) =>{
    try{
        // await this.callback(args)
        const res = await callback.apply(this, args);
        return [null, res];
    }
    catch(err){
        return [err, null];
    }
}